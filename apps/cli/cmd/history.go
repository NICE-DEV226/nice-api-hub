package cmd

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/history"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

func (a *app) history() *history.Store {
	path := a.env.HistoryPath
	if path == "" {
		dir := filepath.Dir(a.cfgPath) // next to the config when no platform paths were given (tests, odd setups)
		if a.env.Paths.Getenv != nil {
			if d, err := a.env.Paths.DataDir(); err == nil {
				dir = d
			}
		}
		path = filepath.Join(dir, "history.jsonl")
	}
	return &history.Store{Path: path}
}

func (a *app) historyCmd() *cobra.Command {
	var limit int
	var clear, yes bool
	cmd := &cobra.Command{
		Use:   "history",
		Short: "What this computer downloaded (download one again with `nah again`)",
		Args:  exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			st := a.history()
			if clear {
				if err := a.requireYes(yes, "Forget the whole download history? (your files are not touched)"); err != nil {
					return err
				}
				if err := st.Clear(); err != nil {
					return err
				}
				a.println(ui.OK.Render("✓ ") + "history cleared")
				return nil
			}
			all, err := st.List()
			if err != nil {
				return err
			}
			if limit > 0 && len(all) > limit {
				all = all[:limit]
			}
			if a.jsonOut {
				if all == nil {
					all = []history.Entry{}
				}
				return a.printJSON(all)
			}
			if len(all) == 0 {
				a.println(ui.MutedText.Render("Nothing downloaded yet. Try: nah download <url>"))
				return nil
			}
			now := a.env.Now()
			rows := make([][]string, 0, len(all))
			for i, e := range all {
				size := "—"
				if e.Bytes > 0 {
					size = ui.Bytes(e.Bytes)
				}
				gone := ""
				if !e.Exists() {
					gone = " (file moved)"
				}
				rows = append(rows, []string{strconv.Itoa(i + 1), ui.Ago(e.At, now), ui.Truncate(e.Title, 48) + gone, e.Label(), size, e.Platform})
			}
			a.println(ui.Table([]string{"#", "WHEN", "TITLE", "QUALITY", "SIZE", "SITE"}, rows))
			a.println(ui.MutedText.Render("  Download one again: nah again <#>"))
			return nil
		},
	}
	cmd.Flags().IntVarP(&limit, "limit", "n", 20, "how many entries to show (0 = all)")
	cmd.Flags().BoolVar(&clear, "clear", false, "forget the whole history")
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")
	return cmd
}

func (a *app) againCmd() *cobra.Command {
	var out string
	var quiet bool
	cmd := &cobra.Command{
		Use:   "again [#|id]",
		Short: "Download something from your history once more (default: the latest)",
		Long:  "Numbers are the ones shown by `nah history` (1 = the most recent). The file is saved next to the\nsame name with \" (2)\" added if the original still exists.",
		Args:  rangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			all, err := a.history().List()
			if err != nil {
				return err
			}
			if len(all) == 0 {
				return usageErr(errors.New("nothing in the history yet"))
			}
			pick := all[0]
			if len(args) == 1 {
				found := false
				if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 && n <= len(all) {
					pick, found = all[n-1], true
				} else {
					for _, e := range all {
						if e.ID == args[0] || (len(args[0]) >= 4 && strings.HasPrefix(e.ID, args[0])) {
							pick, found = e, true
							break
						}
					}
				}
				if !found {
					return usageErr(fmt.Errorf("no history entry %q (see `nah history`)", args[0]))
				}
			}
			dest := out
			if dest == "" {
				dest = filepath.Dir(pick.Path)
			}
			a.printErrln(ui.MutedText.Render("  again: " + ui.OneLine(pick.Title, 60) + " (" + pick.Label() + ")"))
			return a.download(cmd, pick.Request(), pick.Title, dest, false, true, quiet)
		},
	}
	cmd.Flags().StringVarP(&out, "output", "o", "", "file or directory to write to (default: where it went last time)")
	cmd.Flags().BoolVarP(&quiet, "quiet", "q", false, "no progress; print only the saved path")
	return cmd
}
