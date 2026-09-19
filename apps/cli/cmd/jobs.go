package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/tui"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

func (a *app) jobsCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "jobs",
		Short: "Asynchronous extraction: submit now, collect the result later",
	}

	var webhook, idem string
	var wait bool
	submit := &cobra.Command{
		Use:   "submit <url>",
		Short: "Queue an extraction",
		Example: "  nah jobs submit <url> --wait\n" +
			"  nah jobs submit <url> --webhook https://my.app/hooks/nah --idempotency-key order-42",
		Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			job, err := c.SubmitJob(ctx, args[0], webhook, idem)
			if err != nil {
				return err
			}
			if !wait {
				return a.showJob(job)
			}
			return a.waitAndShow(cmd, c, job.ID)
		},
	}
	submit.Flags().StringVar(&webhook, "webhook", "", "URL to receive the signed result")
	submit.Flags().StringVar(&idem, "idempotency-key", "", "make retries of this submission safe")
	submit.Flags().BoolVar(&wait, "wait", false, "wait for the result")

	get := &cobra.Command{
		Use: "get <job-id>", Short: "Show a job", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			job, err := c.Job(ctx, args[0])
			if err != nil {
				return err
			}
			return a.showJob(job)
		},
	}

	waitCmd := &cobra.Command{
		Use: "wait <job-id>", Short: "Wait for a job to finish and show its result", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			return a.waitAndShow(cmd, c, args[0])
		},
	}
	root.AddCommand(submit, get, waitCmd)
	return root
}

func (a *app) waitAndShow(cmd *cobra.Command, c *api.Client, id string) error {
	// Waiting has no --timeout: a job can legitimately take a while. Ctrl+C stops the wait (the job continues).
	poll := func(ctx context.Context) (api.Job, error) { return c.WaitJob(ctx, id, time.Second, nil) }
	var job api.Job
	var err error
	if a.env.StderrTTY && !a.jsonOut {
		job, err = tui.SpinResult(cmd.Context(), a.env.Err, "Waiting for job "+id, poll)
	} else {
		job, err = poll(cmd.Context())
	}
	if err != nil {
		return err
	}
	return a.showJob(job)
}

func (a *app) showJob(j api.Job) error {
	if a.jsonOut {
		if err := a.printJSON(j); err != nil {
			return err
		}
	} else {
		a.printf("%s  %s  %s  %s\n", ui.Bold.Render(j.ID), ui.Dot(j.Status), j.Platform, ui.MutedText.Render(ui.Truncate(j.URL, 60)))
		if j.Webhook != nil {
			a.printf("%s webhook %s %s (%s)\n", ui.MutedText.Render("  ↳"), ui.Dot(j.Webhook.Status),
				ui.Truncate(j.Webhook.URL, 50), ui.Plural(j.Webhook.Attempts, "attempt", "attempts"))
		}
		switch {
		case j.Result != nil:
			a.println("")
			a.renderMedia(*j.Result, nil)
		case j.Error != nil:
			a.println(ui.Danger.Render("  ✗ "+j.Error.Code) + ": " + j.Error.Detail)
		case !j.Done():
			a.println(ui.MutedText.Render("  Not finished yet. Check with `nah jobs get " + j.ID + "` or wait with `nah jobs wait " + j.ID + "`."))
		}
	}
	if j.Status == "failed" {
		return statusError{code: ExitFailure}
	}
	return nil
}

var _ = fmt.Sprint
