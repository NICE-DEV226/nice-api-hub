// Package tui contains the interactive pieces: reusable progress widgets and the full-screen app.
package tui

import (
	"context"
	"io"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

type spinDone struct{ err error }

type spinModel struct {
	sp      spinner.Model
	label   string
	started time.Time
	done    bool
	err     error
	cancel  context.CancelFunc
}

func (m spinModel) Init() tea.Cmd { return m.sp.Tick }

func (m spinModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case spinDone:
		m.done, m.err = true, msg.err
		return m, tea.Quit
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.cancel()
		}
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.sp, cmd = m.sp.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m spinModel) View() string {
	if m.done {
		return ""
	}
	el := time.Since(m.started).Round(time.Second)
	return m.sp.View() + " " + m.label + ui.MutedText.Render("  "+el.String()+"  (ctrl+c to cancel)") + "\n"
}

// Spin shows a spinner on w (normally stderr, so stdout stays pipe-clean) while fn runs.
// Ctrl+C cancels the context passed to fn. The line is erased when fn returns.
func Spin(ctx context.Context, w io.Writer, label string, fn func(ctx context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	sp := spinner.New(spinner.WithSpinner(spinner.MiniDot), spinner.WithStyle(ui.Title))
	p := tea.NewProgram(spinModel{sp: sp, label: label, started: time.Now(), cancel: cancel}, tea.WithOutput(w))
	go func() { p.Send(spinDone{err: fn(ctx)}) }()
	final, err := p.Run()
	if err != nil {
		return err
	}
	// The error of fn wins; a Ctrl+C that fn did not turn into an error still cancels.
	if m, ok := final.(spinModel); ok && m.err != nil {
		return m.err
	}
	return ctx.Err()
}

// SpinResult is Spin for functions returning a value.
func SpinResult[T any](ctx context.Context, w io.Writer, label string, fn func(ctx context.Context) (T, error)) (T, error) {
	var out T
	err := Spin(ctx, w, label, func(c context.Context) error {
		var e error
		out, e = fn(c)
		return e
	})
	return out, err
}
