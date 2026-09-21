package cmd

import (
	"errors"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/tui"
)

// runTUI opens the full-screen interface. A computer with no account lands on the setup screen.
func (a *app) runTUI(cmd *cobra.Command, dir string) error {
	if !a.env.Interactive {
		return usageErr(errors.New("the terminal UI needs an interactive terminal"))
	}
	d, err := a.tuiDeps(dir)
	if err != nil {
		return usageErr(err)
	}
	p := tea.NewProgram(tui.NewApp(d), tea.WithAltScreen(), tea.WithMouseCellMotion(), tea.WithContext(cmd.Context()))
	_, err = p.Run()
	return err
}

func (a *app) tuiCmd() *cobra.Command {
	var dir string
	cmd := &cobra.Command{
		Use:   "tui",
		Short: "Full-screen interface (this is also what plain `nah` opens)",
		Long: "Everything is reachable by keyboard or mouse: click the tabs, click a row, use the wheel.\n" +
			"A new computer starts on a welcome screen that creates its account.",
		Args: exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error { return a.runTUI(cmd, dir) },
	}
	cmd.Flags().StringVar(&dir, "download-dir", "", "where downloads are saved (default: your Downloads folder)")
	return cmd
}
