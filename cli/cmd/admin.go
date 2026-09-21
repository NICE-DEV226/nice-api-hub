package cmd

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// resolveAccount accepts a full id, a unique id prefix, or an exact (case-insensitive) name.
func resolveAccount(ctx context.Context, c *api.Client, ref string) (api.Account, error) {
	if uuidRe.MatchString(ref) {
		return c.GetAccount(ctx, ref)
	}
	list, _, err := c.Accounts(ctx, 100, 0)
	if err != nil {
		return api.Account{}, err
	}
	var hits []api.Account
	for _, acc := range list {
		if strings.EqualFold(acc.Name, ref) || (len(ref) >= 4 && strings.HasPrefix(acc.ID, strings.ToLower(ref))) {
			hits = append(hits, acc)
		}
	}
	switch len(hits) {
	case 0:
		return api.Account{}, usageErr(fmt.Errorf("no account matches %q (use `nah admin accounts list`)", ref))
	case 1:
		return hits[0], nil
	}
	names := make([]string, len(hits))
	for i, h := range hits {
		names[i] = fmt.Sprintf("%s (%s)", h.Name, h.ID[:8])
	}
	return api.Account{}, usageErr(fmt.Errorf("%q is ambiguous: %s", ref, strings.Join(names, ", ")))
}

func (a *app) adminClient(cmd *cobra.Command) (*api.Client, context.Context, context.CancelFunc, error) {
	c, err := a.client()
	if err != nil {
		return nil, nil, nil, usageErr(err)
	}
	ctx, cancel := a.ctx(cmd)
	return c, ctx, cancel, nil
}

func (a *app) adminCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "admin",
		Short: "Operator commands: plans, accounts and API keys (needs the admin token)",
	}
	root.AddCommand(a.adminPlans(), a.adminAccounts(), a.adminKeys(), a.adminUsage(), a.adminWebhookSecret())
	return root
}

func (a *app) adminPlans() *cobra.Command {
	return &cobra.Command{
		Use: "plans", Short: "List plans", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			plans, err := c.Plans(ctx)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(plans)
			}
			rows := make([][]string, 0, len(plans))
			for _, p := range plans {
				daily := "unlimited"
				if p.DailyQuota != nil {
					daily = groupThousands(*p.DailyQuota)
				}
				rows = append(rows, []string{p.ID, p.Name, fmt.Sprintf("%.0f/min", p.RPS*60), fmt.Sprint(p.Burst), daily, fmt.Sprint(p.MaxKeys), platformsOrAll(p.Platforms)})
			}
			a.println(ui.Table([]string{"ID", "NAME", "RATE", "BURST", "DAILY", "KEYS", "PLATFORMS"}, rows))
			return nil
		},
	}
}

func (a *app) adminAccounts() *cobra.Command {
	root := &cobra.Command{Use: "accounts", Short: "Manage customer accounts"}

	var limit, offset int
	list := &cobra.Command{
		Use: "list", Short: "List accounts", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			accs, page, err := c.Accounts(ctx, limit, offset)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(map[string]any{"data": accs, "meta": page})
			}
			now := a.env.Now()
			rows := make([][]string, 0, len(accs))
			for _, acc := range accs {
				created := acc.CreatedAt
				if t, err := time.Parse(time.RFC3339, acc.CreatedAt); err == nil {
					created = ui.Ago(t, now)
				}
				rows = append(rows, []string{acc.ID[:8], acc.Name, acc.PlanID, ui.Dot(acc.Status), created})
			}
			if len(rows) == 0 {
				a.println(ui.MutedText.Render("No accounts yet. Create one with `nah admin accounts create <name> --plan pro`."))
				return nil
			}
			a.println(ui.Table([]string{"ID", "NAME", "PLAN", "STATUS", "CREATED"}, rows))
			a.println(ui.MutedText.Render(fmt.Sprintf("%d of %d shown", len(accs), page.Total)))
			return nil
		},
	}
	list.Flags().IntVar(&limit, "limit", 50, "page size (max 100)")
	list.Flags().IntVar(&offset, "offset", 0, "skip this many accounts")

	get := &cobra.Command{
		Use: "get <account>", Short: "Show an account (id, id prefix or name)", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			acc, err := resolveAccount(ctx, c, args[0])
			if err != nil {
				return err
			}
			keys, err := c.Keys(ctx, acc.ID)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(map[string]any{"account": acc, "keys": keys})
			}
			a.println(ui.KV(
				[2]string{"account", ui.Bold.Render(acc.Name)},
				[2]string{"id", acc.ID},
				[2]string{"plan", acc.PlanID},
				[2]string{"status", ui.Dot(acc.Status)},
				[2]string{"email", ui.Deref(acc.ContactEmail, "—")},
				[2]string{"created", acc.CreatedAt},
			))
			a.println("")
			a.println(a.keysTable(keys))
			return nil
		},
	}

	var plan, email string
	create := &cobra.Command{
		Use: "create <name>", Short: "Create an account", Args: exactArgs(1),
		Example: "  nah admin accounts create \"Acme Corp\" --plan pro --email ops@acme.test",
		RunE: func(cmd *cobra.Command, args []string) error {
			if plan == "" {
				return usageErr(errors.New("--plan is required (see `nah admin plans`)"))
			}
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			acc, err := c.CreateAccount(ctx, args[0], plan, email)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(acc)
			}
			a.printf("%s created account %s %s\n", ui.OK.Render("✓"), ui.Bold.Render(acc.Name), ui.MutedText.Render(acc.ID))
			a.println(ui.MutedText.Render("  Next: nah admin keys create " + acc.ID[:8] + " --label prod"))
			return nil
		},
	}
	create.Flags().StringVar(&plan, "plan", "", "plan id (required)")
	create.Flags().StringVar(&email, "email", "", "contact email")

	var yes bool
	setStatus := func(use, short, status, question string, confirm bool) *cobra.Command {
		cmd := &cobra.Command{
			Use: use + " <account>", Short: short, Args: exactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				c, ctx, cancel, err := a.adminClient(cmd)
				if err != nil {
					return err
				}
				defer cancel()
				acc, err := resolveAccount(ctx, c, args[0])
				if err != nil {
					return err
				}
				if confirm {
					if err := a.requireYes(yes, fmt.Sprintf(question, acc.Name)); err != nil {
						return err
					}
				}
				acc, err = c.UpdateAccount(ctx, acc.ID, "", "", status)
				if err != nil {
					return err
				}
				if a.jsonOut {
					return a.printJSON(acc)
				}
				a.printf("%s %s is now %s\n", ui.OK.Render("✓"), ui.Bold.Render(acc.Name), ui.Dot(acc.Status))
				return nil
			},
		}
		if confirm {
			cmd.Flags().BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")
		}
		return cmd
	}
	suspend := setStatus("suspend", "Suspend an account (its keys stop working)", "suspended", "Suspend %q? Its API keys stop working immediately.", true)
	activate := setStatus("activate", "Reactivate a suspended account", "active", "", false)

	setPlan := &cobra.Command{
		Use: "set-plan <account> <plan>", Short: "Change an account's plan", Args: exactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			acc, err := resolveAccount(ctx, c, args[0])
			if err != nil {
				return err
			}
			acc, err = c.UpdateAccount(ctx, acc.ID, "", args[1], "")
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(acc)
			}
			a.printf("%s %s is now on plan %s (effective immediately)\n", ui.OK.Render("✓"), ui.Bold.Render(acc.Name), ui.Bold.Render(acc.PlanID))
			return nil
		},
	}

	root.AddCommand(list, get, create, suspend, activate, setPlan)
	return root
}

func (a *app) keysTable(keys []api.Key) string {
	if len(keys) == 0 {
		return ui.MutedText.Render("No keys.")
	}
	now := a.env.Now()
	rows := make([][]string, 0, len(keys))
	for _, k := range keys {
		rows = append(rows, []string{k.ID, k.Label, k.Prefix + "…", k.Environment, ui.Dot(k.State(now)), ui.AgoString(k.LastUsedAt, now)})
	}
	return ui.Table([]string{"KEY ID", "LABEL", "PREFIX", "ENV", "STATE", "LAST USED"}, rows)
}

func (a *app) adminKeys() *cobra.Command {
	root := &cobra.Command{Use: "keys", Short: "Manage API keys"}

	list := &cobra.Command{
		Use: "list <account>", Short: "List an account's keys", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			acc, err := resolveAccount(ctx, c, args[0])
			if err != nil {
				return err
			}
			keys, err := c.Keys(ctx, acc.ID)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(keys)
			}
			a.println(a.keysTable(keys))
			return nil
		},
	}

	var label, env string
	var platforms []string
	create := &cobra.Command{
		Use: "create <account>", Short: "Issue an API key (shown once)", Args: exactArgs(1),
		Example: "  nah admin keys create acme --label prod\n  nah admin keys create acme --label yt-only --platform youtube",
		RunE: func(cmd *cobra.Command, args []string) error {
			if label == "" {
				return usageErr(errors.New("--label is required"))
			}
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			acc, err := resolveAccount(ctx, c, args[0])
			if err != nil {
				return err
			}
			k, err := c.CreateKey(ctx, acc.ID, label, env, platforms)
			if err != nil {
				return err
			}
			return a.showNewKey(k, acc.Name)
		},
	}
	create.Flags().StringVar(&label, "label", "", "a name to recognise the key (required)")
	create.Flags().StringVar(&env, "env", "", "live (default) or test")
	create.Flags().StringSliceVar(&platforms, "platform", nil, "restrict the key to these platforms (repeatable)")

	var yes bool
	revoke := &cobra.Command{
		Use: "revoke <key-id>", Short: "Revoke a key immediately", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := a.requireYes(yes, "Revoke key "+args[0]+"? Clients using it stop working immediately."); err != nil {
				return err
			}
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			k, err := c.RevokeKey(ctx, args[0])
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(k)
			}
			a.printf("%s key %s (%s) revoked\n", ui.OK.Render("✓"), ui.Bold.Render(k.Label), k.Prefix+"…")
			return nil
		},
	}
	revoke.Flags().BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")

	var grace time.Duration
	rotate := &cobra.Command{
		Use: "rotate <key-id>", Short: "Issue a replacement; the old key works for a grace period", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			k, err := c.RotateKey(ctx, args[0], int(grace.Seconds()))
			if err != nil {
				return err
			}
			if !a.jsonOut {
				a.println(ui.MutedText.Render(fmt.Sprintf("The previous key keeps working for %s.", grace)))
			}
			return a.showNewKey(k, "")
		},
	}
	rotate.Flags().DurationVar(&grace, "grace", 24*time.Hour, "how long the old key keeps working")

	root.AddCommand(list, create, revoke, rotate)
	return root
}

func (a *app) showNewKey(k api.Key, account string) error {
	if a.jsonOut {
		return a.printJSON(k)
	}
	where := ""
	if account != "" {
		where = " for " + account
	}
	a.printf("%s key %s created%s\n\n", ui.OK.Render("✓"), ui.Bold.Render(k.Label), where)
	a.println("  " + ui.Code.Render(k.Secret))
	a.println(ui.Danger.Render("\n  Copy it now: it cannot be shown again."))
	return nil
}

func (a *app) adminUsage() *cobra.Command {
	var days int
	cmd := &cobra.Command{
		Use: "usage <account>", Short: "An account's consumption", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			acc, err := resolveAccount(ctx, c, args[0])
			if err != nil {
				return err
			}
			rows, err := c.AccountUsage(ctx, acc.ID, days)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(rows)
			}
			a.println(ui.Bold.Render(acc.Name) + ui.MutedText.Render("  plan "+acc.PlanID))
			a.println("")
			a.renderUsage(api.Usage{Plan: acc.PlanID, Usage: rows}, days)
			return nil
		},
	}
	cmd.Flags().IntVar(&days, "days", 7, "number of days")
	return cmd
}

func (a *app) adminWebhookSecret() *cobra.Command {
	root := &cobra.Command{Use: "webhook-secret", Short: "Manage the webhook signing secret"}
	var yes bool
	rot := &cobra.Command{
		Use: "rotate <account>", Short: "Issue a new webhook secret (receivers must update it)", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, ctx, cancel, err := a.adminClient(cmd)
			if err != nil {
				return err
			}
			defer cancel()
			acc, err := resolveAccount(ctx, c, args[0])
			if err != nil {
				return err
			}
			if err := a.requireYes(yes, "Rotate the webhook secret of "+acc.Name+"? Receivers must be updated."); err != nil {
				return err
			}
			acc, err = c.RotateWebhookSecret(ctx, acc.ID)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(map[string]string{"webhookSecret": acc.WebhookSecret})
			}
			a.printf("%s new secret for %s:\n\n  %s\n", ui.OK.Render("✓"), ui.Bold.Render(acc.Name), ui.Code.Render(acc.WebhookSecret))
			return nil
		},
	}
	rot.Flags().BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")
	root.AddCommand(rot)
	return root
}
