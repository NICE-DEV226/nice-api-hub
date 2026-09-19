package cmd

import (
	"context"
	"fmt"
	"sort"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

type statusReport struct {
	URL       string               `json:"url"`
	Ready     bool                 `json:"ready"`
	Status    string               `json:"status"`
	Checks    map[string]bool      `json:"checks"`
	Platforms []api.PlatformStatus `json:"platforms"`
}

func (a *app) statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Gateway health and platform availability (no credentials needed)",
		Long:  "Exits with status 1 when the gateway is not ready or a platform is down, so it can gate scripts and health checks.",
		Args:  exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			rd, err := c.Ready(ctx)
			if err != nil {
				return err
			}
			plats, err := c.Platforms(ctx)
			if err != nil {
				return err
			}
			rep := statusReport{URL: c.BaseURL, Ready: rd.Status == "ready", Status: rd.Status, Checks: rd.Checks, Platforms: plats}
			healthy := rep.Ready
			for _, p := range plats {
				if p.Status == "down" {
					healthy = false
				}
			}
			if a.jsonOut {
				if err := a.printJSON(rep); err != nil {
					return err
				}
			} else {
				a.render(rep)
			}
			if !healthy {
				return statusError{code: ExitFailure}
			}
			return nil
		},
	}
}

func (a *app) render(r statusReport) {
	a.println(ui.Title.Render("nah") + " " + ui.MutedText.Render("▸ ") + r.URL)
	names := make([]string, 0, len(r.Checks))
	for n := range r.Checks {
		names = append(names, n)
	}
	sort.Strings(names)
	line := ui.Dot(r.Status)
	for _, n := range names {
		mark := ui.OK.Render("✓")
		if !r.Checks[n] {
			mark = ui.Danger.Render("✗")
		}
		line += "   " + n + " " + mark
	}
	a.println(line)
	a.println("")
	rows := make([][]string, 0, len(r.Platforms))
	for _, p := range r.Platforms {
		rows = append(rows, []string{p.Name, ui.Dot(p.Status)})
	}
	if len(rows) == 0 {
		a.println(ui.MutedText.Render("No platform available."))
		return
	}
	a.println(ui.Table([]string{"PLATFORM", "STATUS"}, rows))
	a.println(ui.MutedText.Render(fmt.Sprintf("%s. \"unknown\" means no probe has run yet.", ui.Plural(len(rows), "platform", "platforms"))))
}

var _ = context.Background
