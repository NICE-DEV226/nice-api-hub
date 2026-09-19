package cmd

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

func (a *app) loginCmd() *cobra.Command {
	var apiKeyStdin, adminStdin bool
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Save credentials for a gateway (checks them first)",
		Long: "Stores the gateway URL, and optionally an API key (customer) and/or an admin token (operator).\n" +
			"Secrets are asked without echo and saved in a private file (mode 0600).\n" +
			"For scripts: pipe the secret and pass --api-key-stdin or --admin-token-stdin.",
		Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			if apiKeyStdin && adminStdin {
				return usageErr(errors.New("--api-key-stdin and --admin-token-stdin are mutually exclusive"))
			}
			pr := a.env.Prompt
			name := a.res.Profile
			cur := a.file.Profiles[name]

			url := a.res.URL
			apiKey, admin := cur.APIKey, cur.AdminToken
			switch {
			case apiKeyStdin:
				s, err := pr.ReadLine("")
				if err != nil {
					return err
				}
				apiKey = s
			case adminStdin:
				s, err := pr.ReadLine("")
				if err != nil {
					return err
				}
				admin = s
			default:
				if !a.env.Interactive && a.env.Getenv("NAH_API_KEY") == "" {
					return usageErr(errors.New("login is interactive: run it in a terminal, or pipe a secret with --api-key-stdin / --admin-token-stdin"))
				}
				if a.urlFlag == "" {
					s, err := pr.ReadLine(fmt.Sprintf("Gateway URL [%s]: ", url))
					if err != nil {
						return err
					}
					if s != "" {
						url = strings.TrimRight(s, "/")
					}
				}
				s, err := pr.ReadSecret(fmt.Sprintf("API key (customer) [%s]: ", config.Mask(apiKey)))
				if err != nil {
					return err
				}
				if s != "" {
					apiKey = s
				}
				s, err = pr.ReadSecret(fmt.Sprintf("Admin token (operator) [%s]: ", config.Mask(admin)))
				if err != nil {
					return err
				}
				if s != "" {
					admin = s
				}
			}

			c, err := api.New(url, apiKey, admin)
			if err != nil {
				return usageErr(err)
			}
			if a.env.HTTPClient != nil {
				c.HTTP = a.env.HTTPClient
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()

			rd, err := c.Ready(ctx)
			if err != nil {
				return err
			}
			a.println(ui.OK.Render("✓ ") + "gateway reachable at " + url + " (" + rd.Status + ")")
			if apiKey != "" {
				acc, err := c.Account(ctx)
				if err != nil {
					return fmt.Errorf("the API key was rejected: %w", err)
				}
				a.println(ui.OK.Render("✓ ") + "API key valid: account " + ui.Bold.Render(acc.Name) + " (plan " + acc.Plan + ")")
			}
			if admin != "" {
				if _, err := c.Plans(ctx); err != nil {
					return fmt.Errorf("the admin token was rejected: %w", err)
				}
				a.println(ui.OK.Render("✓ ") + "admin token valid")
			}

			a.file.Profiles[name] = config.Profile{URL: url, APIKey: apiKey, AdminToken: admin}
			a.file.Current = name
			if err := a.file.Save(a.cfgPath); err != nil {
				return err
			}
			a.println(ui.MutedText.Render("  saved profile \"" + name + "\" to " + a.cfgPath))
			return nil
		},
	}
	cmd.Flags().BoolVar(&apiKeyStdin, "api-key-stdin", false, "read the API key from stdin")
	cmd.Flags().BoolVar(&adminStdin, "admin-token-stdin", false, "read the admin token from stdin")
	return cmd
}

func (a *app) configCmd() *cobra.Command {
	root := &cobra.Command{Use: "config", Short: "Inspect and switch configuration profiles"}

	root.AddCommand(&cobra.Command{
		Use: "show", Short: "Show the effective configuration (secrets masked)", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			if a.jsonOut {
				return a.printJSON(map[string]string{"profile": a.res.Profile, "url": a.res.URL,
					"apiKey": config.Mask(a.res.APIKey), "adminToken": config.Mask(a.res.AdminToken), "file": a.cfgPath})
			}
			a.println(ui.KV(
				[2]string{"profile", ui.Bold.Render(a.res.Profile)},
				[2]string{"url", a.res.URL},
				[2]string{"api key", config.Mask(a.res.APIKey)},
				[2]string{"admin token", config.Mask(a.res.AdminToken)},
				[2]string{"file", a.cfgPath},
			))
			return nil
		},
	})

	root.AddCommand(&cobra.Command{
		Use: "list", Short: "List profiles", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			names := a.file.Names()
			if a.jsonOut {
				return a.printJSON(map[string]any{"current": a.file.Current, "profiles": names})
			}
			if len(names) == 0 {
				a.println(ui.MutedText.Render("No profile yet. Run `nah login`."))
				return nil
			}
			for _, n := range names {
				mark := "  "
				if n == a.res.Profile {
					mark = ui.OK.Render("● ")
				}
				p := a.file.Profiles[n]
				a.printf("%s%s  %s\n", mark, ui.Bold.Render(n), ui.MutedText.Render(p.URL))
			}
			return nil
		},
	})

	root.AddCommand(&cobra.Command{
		Use: "use <profile>", Short: "Switch the current profile", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if _, ok := a.file.Profiles[args[0]]; !ok {
				return usageErr(fmt.Errorf("unknown profile %q (have: %s)", args[0], strings.Join(a.file.Names(), ", ")))
			}
			a.file.Current = args[0]
			if err := a.file.Save(a.cfgPath); err != nil {
				return err
			}
			a.println(ui.OK.Render("✓ ") + "current profile: " + args[0])
			return nil
		},
	})

	root.AddCommand(&cobra.Command{
		Use: "path", Short: "Print the configuration file path", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error { a.println(a.cfgPath); return nil },
	})
	return root
}
