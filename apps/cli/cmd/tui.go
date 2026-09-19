package cmd

import (
	"errors"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/tui"
)

func (a *app) tuiCmd() *cobra.Command {
	var dir string
	cmd := &cobra.Command{
		Use:   "tui",
		Short: "Full-screen interface: dashboard, accounts and a media playground",
		Long: "Tabs adapt to your credentials: the Dashboard always works; Accounts needs the admin token;\n" +
			"the Playground (resolve and download media) needs an API key.",
		Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !a.env.Interactive {
				return usageErr(errors.New("the terminal UI needs an interactive terminal"))
			}
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			d := tui.Deps{
				Client:      c,
				Profile:     a.res.Profile,
				HasAPI:      a.res.APIKey != "",
				HasAdmin:    a.res.AdminToken != "",
				Now:         a.env.Now,
				DownloadDir: dir,
				Refresh:     15 * time.Second,
			}
			p := tea.NewProgram(tui.NewApp(d), tea.WithAltScreen(), tea.WithContext(cmd.Context()))
			_, err = p.Run()
			return err
		},
	}
	cmd.Flags().StringVar(&dir, "download-dir", ".", "where the Playground saves downloads")
	return cmd
}
