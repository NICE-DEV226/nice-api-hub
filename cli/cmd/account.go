package cmd

import (
	"fmt"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

func formatLimits(l api.Limits) string {
	daily := "unlimited/day"
	if l.DailyQuota != nil {
		daily = fmt.Sprintf("%s/day", groupThousands(*l.DailyQuota))
	}
	return fmt.Sprintf("%.0f req/min · burst %d · %s", l.RPS*60, l.Burst, daily)
}

func groupThousands(n int64) string {
	s := fmt.Sprint(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

func platformsOrAll(p []string) string {
	if len(p) == 0 {
		return "all"
	}
	return strings.Join(p, ", ")
}

func (a *app) accountCmd() *cobra.Command {
	var showSecret bool
	cmd := &cobra.Command{
		Use:   "account",
		Short: "Your account, plan and limits (needs an API key)",
		Args:  exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			acc, err := c.Account(ctx)
			if err != nil {
				return err
			}
			secret := config.Mask(acc.WebhookSecret)
			if showSecret {
				secret = acc.WebhookSecret
			}
			if a.jsonOut {
				acc.WebhookSecret = secret
				return a.printJSON(acc)
			}
			a.println(ui.KV(
				[2]string{"account", ui.Bold.Render(acc.Name)},
				[2]string{"id", acc.ID},
				[2]string{"plan", acc.Plan},
				[2]string{"limits", formatLimits(acc.Limits)},
				[2]string{"platforms", platformsOrAll(acc.Platforms)},
				[2]string{"webhook secret", secret},
			))
			if !showSecret {
				a.println(ui.MutedText.Render("\nReveal the webhook secret with --show-secret."))
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&showSecret, "show-secret", false, "print the webhook signing secret")
	return cmd
}

func (a *app) usageCmd() *cobra.Command {
	var days int
	cmd := &cobra.Command{
		Use:   "usage",
		Short: "Your recent consumption and today's quota (needs an API key)",
		Args:  exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			u, err := c.Usage(ctx, days)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(u)
			}
			a.renderUsage(u, days)
			return nil
		},
	}
	cmd.Flags().IntVar(&days, "days", 7, "number of days to include (1-90)")
	return cmd
}

func (a *app) renderUsage(u api.Usage, days int) {
	today := a.env.Now().UTC().Format("2006-01-02")
	var todayReq int64
	for _, r := range u.Usage {
		if r.Day == today {
			todayReq += r.Requests
		}
	}
	a.printf("%s  %s\n", ui.Bold.Render("plan "+u.Plan), ui.MutedText.Render(formatLimits(u.Limits)))
	if u.Limits.DailyQuota != nil {
		q := *u.Limits.DailyQuota
		a.printf("today  %s  %s / %s\n", ui.Bar(todayReq, q, 30), groupThousands(todayReq), groupThousands(q))
	} else {
		a.printf("today  %s requests %s\n", groupThousands(todayReq), ui.MutedText.Render("(unlimited plan)"))
	}
	a.println("")
	rows := append([]api.UsageRow(nil), u.Usage...)
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Day != rows[j].Day {
			return rows[i].Day > rows[j].Day
		}
		return rows[i].Platform < rows[j].Platform
	})
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{r.Day, r.Platform, fmt.Sprint(r.Requests), fmt.Sprint(r.CacheHits), fmt.Sprint(r.Errors), fmt.Sprint(r.RateLimited)})
	}
	if len(out) == 0 {
		a.println(ui.MutedText.Render(fmt.Sprintf("No usage in the last %d days.", days)))
		return
	}
	a.println(ui.Table([]string{"DAY", "PLATFORM", "REQUESTS", "CACHED", "ERRORS", "LIMITED"}, out))
}
