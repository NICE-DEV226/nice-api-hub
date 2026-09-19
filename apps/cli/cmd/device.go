package cmd

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/onboard"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

// onboarder builds the service that gives this computer an account, talking to the resolved gateway
// without any credentials (registration is public).
func (a *app) onboarder() (onboard.Service, error) {
	c, err := api.New(a.res.URL, "", "")
	if err != nil {
		return onboard.Service{}, usageErr(err)
	}
	c.UserAgent = "nah-cli/" + a.env.Version
	if a.env.HTTPClient != nil {
		c.HTTP = a.env.HTTPClient
	}
	return onboard.Service{Client: c, Device: a.env.Device, Solve: a.env.Solve}, nil
}

// remember saves an enrollment as this profile's identity and tells the user where the key went.
func (a *app) remember(en api.Enrollment) error {
	inKeychain, err := onboard.Remember(a.file, a.cfgPath, a.env.Secrets, a.res.Profile, a.res.URL, en, a.env.Device.Name())
	if err != nil {
		return err
	}
	if inKeychain {
		a.printErrln(ui.MutedText.Render("  key stored in the system keychain"))
	} else {
		a.printErrln(ui.MutedText.Render("  key stored in " + a.cfgPath + " (private file: no system keychain here)"))
	}
	return nil
}

func (a *app) printErrln(s string) {
	if !a.jsonOut {
		fmt.Fprintln(a.env.Err, s)
	}
}

func (a *app) progress(step string) { a.printErrln(ui.MutedText.Render("  · " + step + "…")) }

// showRecovery prints the recovery key prominently (it exists only once) and, on a terminal, offers a file.
func (a *app) showRecovery(en api.Enrollment, saveDir string) error {
	a.println("")
	a.println(ui.Warning.Bold(true).Render("Your recovery key — shown only once"))
	a.println("  " + ui.Bold.Render(en.RecoveryKey))
	a.println(ui.MutedText.Render("  It is the only way back into this account if you lose this computer (`nah recover`)."))

	save := saveDir != ""
	if !save && a.env.Interactive {
		ok, err := a.env.Prompt.Confirm("Save it to a file?")
		if err != nil {
			return err
		}
		save = ok
		saveDir = a.downloadDir()
	}
	if save {
		path, err := onboard.SaveRecoveryFile(saveDir, en.Account.Name, a.res.URL, en.RecoveryKey, a.env.Now())
		if err != nil {
			return fmt.Errorf("could not save the recovery file: %w", err)
		}
		a.println(ui.OK.Render("✓ ") + "saved to " + path + ui.MutedText.Render("  (move it somewhere safe)"))
	}
	return nil
}

func (a *app) downloadDir() string {
	if a.res.DownloadDir != "" {
		return a.res.DownloadDir
	}
	return a.env.Paths.DownloadsDir()
}

func (a *app) alreadySetUp() error {
	if a.res.APIKey == "" {
		return nil
	}
	who := a.res.AccountName
	if who == "" {
		who = "an API key"
	}
	return usageErr(fmt.Errorf("this computer is already set up for %s on %s (profile %q). Use --profile to keep another one, or `nah account` to inspect it", who, a.res.URL, a.res.Profile))
}

func (a *app) registerCmd() *cobra.Command {
	var name, invite, saveDir string
	cmd := &cobra.Command{
		Use:   "register",
		Short: "Create an account for this computer (no e-mail, no password)",
		Long: "Creates an account tied to this computer and stores its key in the system keychain.\n" +
			"You also get a recovery key, shown once: keep it, it is the way back if you lose this computer.\n" +
			"To use an account you already have on another computer, run `nah link` there and `nah link <code>` here.",
		Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := a.alreadySetUp(); err != nil {
				return err
			}
			svc, err := a.onboarder()
			if err != nil {
				return err
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			en, err := svc.Register(ctx, name, invite, a.progress)
			if err != nil {
				return err
			}
			if err := a.remember(en); err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(map[string]any{"account": en.Account, "keyId": en.KeyID, "recoveryKey": en.RecoveryKey})
			}
			a.println(ui.OK.Render("✓ ") + "account " + ui.Bold.Render(en.Account.Name) + " created (plan " + en.Account.Plan + ")")
			if err := a.showRecovery(en, saveDir); err != nil {
				return err
			}
			a.println("\n" + ui.MutedText.Render("Ready. Try: nah media <url>   ·   nah download <url>   ·   nah"))
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "account name (default: this computer's name)")
	cmd.Flags().StringVar(&invite, "invite", "", "invite code, when the gateway requires one")
	cmd.Flags().StringVar(&saveDir, "save-recovery", "", "write the recovery key to a file in this directory")
	return cmd
}

func (a *app) linkCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "link [code]",
		Short: "Add another computer to your account (no argument: make a code; with a code: join)",
		Long: "On the computer that already has the account:   nah link        → prints a one-time code (10 minutes)\n" +
			"On the new computer:                             nah link K7QM-2XPD",
		Example: "  nah link\n  nah link K7QM-2XPD",
		Args:    rangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, cancel := a.ctx(cmd)
			defer cancel()

			if len(args) == 0 {
				c, err := a.client()
				if err != nil {
					return usageErr(err)
				}
				lc, err := c.NewLinkCode(ctx)
				if err != nil {
					return err
				}
				if a.jsonOut {
					return a.printJSON(lc)
				}
				a.println("Link code: " + ui.Title.Render(lc.Code) + ui.MutedText.Render(fmt.Sprintf("  (valid %d min, single use)", lc.TTLSeconds/60)))
				a.println(ui.MutedText.Render("On the other computer, install nah and run:  nah link " + lc.Code))
				if m, err := a.env.Clipboard.Copy(lc.Code); err == nil && m != "" {
					a.println(ui.MutedText.Render("  (copied to the clipboard)"))
				}
				return nil
			}

			if err := a.alreadySetUp(); err != nil {
				return err
			}
			svc, err := a.onboarder()
			if err != nil {
				return err
			}
			en, err := svc.Redeem(ctx, args[0])
			if err != nil {
				return err
			}
			if err := a.remember(en); err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(map[string]any{"account": en.Account, "keyId": en.KeyID})
			}
			a.println(ui.OK.Render("✓ ") + "this computer now uses account " + ui.Bold.Render(en.Account.Name) + " (plan " + en.Account.Plan + ")")
			return nil
		},
	}
}

func (a *app) recoverCmd() *cobra.Command {
	var stdin bool
	cmd := &cobra.Command{
		Use:   "recover",
		Short: "Get back into your account on this computer with your recovery key",
		Args:  exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := a.alreadySetUp(); err != nil {
				return err
			}
			var rk string
			var err error
			if stdin {
				rk, err = a.env.Prompt.ReadLine("")
			} else {
				if !a.env.Interactive {
					return usageErr(errors.New("recover is interactive: run it in a terminal, or pipe the recovery key with --stdin"))
				}
				rk, err = a.env.Prompt.ReadSecret("Recovery key: ")
			}
			if err != nil {
				return err
			}
			if strings.TrimSpace(rk) == "" {
				return usageErr(errors.New("no recovery key given"))
			}
			svc, err := a.onboarder()
			if err != nil {
				return err
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			en, err := svc.Recover(ctx, rk)
			if err != nil {
				return err
			}
			if err := a.remember(en); err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(map[string]any{"account": en.Account, "keyId": en.KeyID})
			}
			a.println(ui.OK.Render("✓ ") + "welcome back, " + ui.Bold.Render(en.Account.Name) + ". This computer has its own key now.")
			return nil
		},
	}
	cmd.Flags().BoolVar(&stdin, "stdin", false, "read the recovery key from stdin")
	return cmd
}

func (a *app) initCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init [url]",
		Short: "Point nah at a gateway and set this computer up",
		Long: "Checks the gateway, remembers its URL, and creates your account when the gateway allows it.\n" +
			"Operators can bake a default URL into the binary; everyone else runs `nah init https://gateway.example`.",
		Args: rangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				a.res.URL = strings.TrimRight(args[0], "/")
			}
			svc, err := a.onboarder()
			if err != nil {
				return err
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()

			rd, err := svc.Client.Ready(ctx)
			if err != nil {
				return err
			}
			a.println(ui.OK.Render("✓ ") + "gateway reachable at " + a.res.URL + " (" + rd.Status + ")")

			p := a.file.Profiles[a.res.Profile]
			p.URL = a.res.URL
			a.file.Profiles[a.res.Profile] = p
			a.file.Current = a.res.Profile
			if err := a.file.Save(a.cfgPath); err != nil {
				return err
			}
			if a.res.APIKey != "" {
				a.println(ui.MutedText.Render("  this computer already has a key for this gateway; nothing else to do."))
				return nil
			}
			info, err := svc.Info(ctx)
			if err != nil {
				return err
			}
			if !info.Open() {
				a.println(ui.MutedText.Render("  this gateway does not create accounts by itself: ask its operator for a key, then `nah login`."))
				return nil
			}
			a.println(ui.MutedText.Render("  this gateway lets you create an account: running `nah register`."))
			return a.registerCmd().RunE(cmd, nil)
		},
	}
}

func (a *app) keysCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "keys",
		Short: "Your own keys: one per computer, plus any you make for scripts",
	}

	root.AddCommand(&cobra.Command{
		Use: "list", Short: "List your keys", Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			keys, err := c.MyKeys(ctx)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(keys)
			}
			a.println(a.myKeysTable(keys))
			return nil
		},
	})

	var scopes []string
	create := &cobra.Command{
		Use: "create <label>", Short: "Create a key (for a script, an app, …)", Args: exactArgs(1),
		Long: "Scopes: media (download, default), keys (manage keys), recover (offline recovery only).\nThe key is shown once.",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			k, err := c.CreateMyKey(ctx, args[0], scopes)
			if err != nil {
				return err
			}
			if a.jsonOut {
				return a.printJSON(k)
			}
			a.println(ui.OK.Render("✓ ") + "key " + ui.Bold.Render(k.Label) + " created")
			a.println("  " + ui.Bold.Render(k.Secret))
			a.println(ui.MutedText.Render("  Shown once. Use it as NAH_API_KEY or `Authorization: Bearer …`."))
			return nil
		},
	}
	create.Flags().StringSliceVar(&scopes, "scope", nil, "scopes: media, keys, recover (repeatable; default media)")
	root.AddCommand(create)

	var yes bool
	revoke := &cobra.Command{
		Use: "revoke <id>", Short: "Revoke one of your keys (an id prefix is enough)", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			k, err := a.findMyKey(ctx, c, args[0])
			if err != nil {
				return err
			}
			q := fmt.Sprintf("Revoke %q?", k.Label)
			if k.Current {
				q = fmt.Sprintf("Revoke %q — the key THIS computer uses? You will need `nah recover` or `nah link` afterwards.", k.Label)
			}
			if err := a.requireYes(yes, q); err != nil {
				return err
			}
			if _, err := c.RevokeMyKey(ctx, k.ID); err != nil {
				return err
			}
			if k.Current {
				if _, err := a.file.StoreSecret(a.env.Secrets, a.res.Profile, config.KindAPIKey, ""); err != nil {
					return err
				}
				if err := a.file.Save(a.cfgPath); err != nil {
					return err
				}
			}
			a.println(ui.OK.Render("✓ ") + "revoked " + ui.Bold.Render(k.Label))
			return nil
		},
	}
	revoke.Flags().BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")
	root.AddCommand(revoke)

	var grace int
	rotate := &cobra.Command{
		Use: "rotate <id>", Short: "Replace a key; the old one keeps working for a grace period", Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			k, err := a.findMyKey(ctx, c, args[0])
			if err != nil {
				return err
			}
			nk, err := c.RotateMyKey(ctx, k.ID, grace)
			if err != nil {
				return err
			}
			if k.Current { // this computer's own key: keep using the new one
				en := api.Enrollment{Key: nk.Secret, KeyID: nk.ID, Account: api.AccountBrief{ID: a.file.Profiles[a.res.Profile].AccountID, Name: a.res.AccountName, Plan: a.file.Profiles[a.res.Profile].Plan}}
				if err := a.remember(en); err != nil {
					return err
				}
				if a.jsonOut {
					return a.printJSON(map[string]any{"keyId": nk.ID, "replaced": k.ID, "stored": true})
				}
				a.println(ui.OK.Render("✓ ") + "this computer's key was replaced and the new one is saved")
				return nil
			}
			if a.jsonOut {
				return a.printJSON(nk)
			}
			a.println(ui.OK.Render("✓ ") + "new key for " + ui.Bold.Render(nk.Label))
			a.println("  " + ui.Bold.Render(nk.Secret))
			a.println(ui.MutedText.Render(fmt.Sprintf("  Shown once. The old key works for %s more.", ui.Duration(float64(grace)))))
			return nil
		},
	}
	rotate.Flags().IntVar(&grace, "grace", 3600, "seconds the old key keeps working")
	root.AddCommand(rotate)
	return root
}

func (a *app) myKeysTable(keys []api.Key) string {
	if len(keys) == 0 {
		return ui.MutedText.Render("No keys.")
	}
	now := a.env.Now()
	rows := make([][]string, 0, len(keys))
	for _, k := range keys {
		label := k.Label
		if k.Current {
			label += " (this computer)"
		}
		rows = append(rows, []string{shortID(k.ID), label, k.Prefix + "…", strings.Join(k.Scopes, ","), k.CreatedVia, ui.Dot(k.State(now)), ui.AgoString(k.LastUsedAt, now)})
	}
	return ui.Table([]string{"ID", "LABEL", "PREFIX", "SCOPES", "VIA", "STATE", "LAST USED"}, rows)
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// findMyKey resolves an id or unambiguous id prefix to one of the caller's keys.
func (a *app) findMyKey(ctx context.Context, c *api.Client, ref string) (api.Key, error) {
	keys, err := c.MyKeys(ctx)
	if err != nil {
		return api.Key{}, err
	}
	ref = strings.ToLower(strings.TrimSpace(ref))
	var hits []api.Key
	for _, k := range keys {
		if ref != "" && strings.HasPrefix(strings.ToLower(k.ID), ref) {
			hits = append(hits, k)
		}
	}
	switch len(hits) {
	case 1:
		return hits[0], nil
	case 0:
		return api.Key{}, usageErr(fmt.Errorf("no key of yours matches %q (see `nah keys list`)", ref))
	}
	return api.Key{}, usageErr(fmt.Errorf("%q matches %d keys: type more of the id", ref, len(hits)))
}
