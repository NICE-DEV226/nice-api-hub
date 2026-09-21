package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/update"
)

const maxArchive = 200 << 20

func (a *app) updateCmd() *cobra.Command {
	var check, pre, yes, force bool
	var target string
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update nah to the latest release",
		Long: "Looks for a newer release on GitHub, downloads the archive for this system, checks it against the release's\n" +
			"SHA256SUMS, and replaces the running program. Nothing is changed if any step fails.\n\n" +
			"Final releases only, unless you are running a pre-release or pass --pre. --check only looks.",
		Example: "  nah update --check\n  nah update\n  nah update --version 0.2.0 --yes",
		Args:    exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.runUpdate(cmd, updateOptions{check: check, pre: pre, yes: yes, force: force, target: target})
		},
	}
	f := cmd.Flags()
	f.BoolVar(&check, "check", false, "only report whether an update exists")
	f.BoolVar(&pre, "pre", false, "also consider pre-releases")
	f.StringVar(&target, "version", "", "install this exact version (also to go back to an older one)")
	f.BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")
	f.BoolVar(&force, "force", false, "update a build that has no version (built from source)")
	return cmd
}

type updateOptions struct {
	check, pre, yes, force bool
	target                 string
}

func (a *app) runUpdate(cmd *cobra.Command, o updateOptions) error {
	cur, curOK := update.ParseVersion(a.env.Version)
	if !curOK && !o.force {
		return usageErr(errors.New("this build has no release version (it was built from source). Update it with `git pull && make install` in the repository, " +
			"or run `nah update --force` to install the latest release over it"))
	}

	api := a.env.Getenv("NAH_UPDATE_API")
	if api == "" {
		api = update.DefaultAPI
	}
	hc, dl := a.env.HTTPClient, a.env.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
		dl = &http.Client{} // a large download must not be cut by a short overall timeout: Ctrl+C cancels it
	}

	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	lctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	token := a.env.Getenv("NAH_GITHUB_TOKEN")
	if token == "" {
		token = a.env.Getenv("GITHUB_TOKEN")
	}
	releases, err := update.FetchWithToken(lctx, hc, api, token)
	if err != nil {
		return err
	}

	includePre := o.pre || !curOK || cur.IsPrerelease() // whoever runs a pre-release wants to hear about the next one
	var rel update.Release
	var found bool
	if o.target != "" {
		if rel, found = update.Find(releases, o.target); !found {
			return usageErr(fmt.Errorf("there is no release %s (see %s)", o.target, "https://github.com/NICE-DEV226/nice-api-hub/releases"))
		}
	} else if rel, found = update.Latest(releases, includePre); !found {
		if len(releases) > 0 { // there are releases, but only pre-releases
			return fmt.Errorf("there is no final release yet: the newest is the pre-release %s. Run `nah update --pre` to use it", releases[0].Version)
		}
		return errors.New("no release of nah was found")
	}

	newer := !curOK || update.Compare(rel.Version, cur) > 0
	if a.jsonOut && o.check {
		return a.printJSON(map[string]any{"current": a.env.Version, "latest": rel.Version.String(), "updateAvailable": newer, "page": rel.Page})
	}
	if o.target == "" && !newer {
		a.println(ui.OK.Render("✓ ") + "nah " + a.env.Version + " is up to date")
		return nil
	}
	if o.check {
		a.printf("%s %s → %s\n", ui.Warning.Render("Update available:"), a.env.Version, ui.Bold.Render(rel.Version.String()))
		if rel.Page != "" {
			a.println(ui.MutedText.Render("  " + rel.Page))
		}
		a.println(ui.MutedText.Render("  Run: nah update"))
		return nil
	}
	if o.target != "" && curOK && update.Compare(rel.Version, cur) == 0 && !o.force {
		a.println(ui.OK.Render("✓ ") + "already on nah " + a.env.Version)
		return nil
	}

	archive := update.ArchiveName(rel.Version.String(), runtime.GOOS, runtime.GOARCH)
	asset, ok := rel.Asset(archive)
	sums, okSums := rel.Asset("SHA256SUMS")
	if !ok || !okSums {
		return fmt.Errorf("release %s has no build for %s/%s (looked for %s)", rel.Version, runtime.GOOS, runtime.GOARCH, archive)
	}

	verb := "Update"
	if curOK && update.Compare(rel.Version, cur) < 0 {
		verb = "Go back from"
	}
	question := fmt.Sprintf("%s nah %s → %s?", verb, a.env.Version, rel.Version)
	if err := a.requireYes(o.yes, question); err != nil {
		return err
	}

	exe, err := a.env.Executable()
	if err != nil {
		return fmt.Errorf("cannot tell where nah is installed: %w", err)
	}

	size := ""
	if asset.Size > 0 {
		size = " (" + ui.Bytes(asset.Size) + ")"
	}
	a.printErrln(ui.MutedText.Render("  downloading nah " + rel.Version.String() + size + "…"))
	data, err := update.Download(ctx, dl, asset.URL, maxArchive)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	sumsDoc, err := update.Download(ctx, dl, sums.URL, 1<<20)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	want, ok := update.ChecksumFor(sumsDoc, archive)
	if !ok {
		return fmt.Errorf("%s is not listed in the release's SHA256SUMS: refusing to install it", archive)
	}
	if err := update.VerifySHA256(data, want); err != nil {
		return fmt.Errorf("the download is corrupt or has been tampered with (%w): nothing was changed", err)
	}
	a.printErrln(ui.MutedText.Render("  checksum verified"))

	bin, err := update.ExtractBinary(data, archive)
	if err != nil {
		return err
	}
	if err := update.ReplaceExecutable(exe, bin); err != nil {
		return err
	}

	if a.jsonOut {
		return a.printJSON(map[string]any{"previous": a.env.Version, "current": rel.Version.String(), "path": exe})
	}
	a.printf("%s nah is now %s %s\n", ui.OK.Render("✓"), ui.Bold.Render(rel.Version.String()), ui.MutedText.Render("(was "+a.env.Version+")"))
	if rel.Page != "" {
		a.println(ui.MutedText.Render("  what changed: " + rel.Page))
	}
	return nil
}
