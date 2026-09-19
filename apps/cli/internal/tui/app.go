package tui

import (
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

type tabID int

const (
	tabDashboard tabID = iota
	tabAccounts
	tabPlayground
)

type tabInfo struct {
	id    tabID
	title string
	v     view
}

type refreshTick struct{}

// App is the full-screen interface.
type App struct {
	d        Deps
	w, h     int
	tabs     []tabInfo
	active   int
	dash     *dashboard
	help     help.Model
	showHelp bool
	quitting bool
}

// NewApp builds the interface for the given capabilities.
func NewApp(d Deps) *App {
	d.defaults()
	a := &App{d: d, help: help.New()}
	a.dash = newDashboard(d)
	a.tabs = append(a.tabs, tabInfo{tabDashboard, "Dashboard", a.dash})
	if d.HasAdmin {
		a.tabs = append(a.tabs, tabInfo{tabAccounts, "Accounts", newAccounts(d)})
	}
	if d.HasAPI {
		a.tabs = append(a.tabs, tabInfo{tabPlayground, "Playground", newPlayground(d)})
	}
	return a
}

func (a *App) Init() tea.Cmd {
	cmds := make([]tea.Cmd, 0, len(a.tabs)+1)
	for _, t := range a.tabs {
		cmds = append(cmds, t.v.Init())
	}
	if a.d.Refresh > 0 {
		cmds = append(cmds, tea.Tick(a.d.Refresh, func(time.Time) tea.Msg { return refreshTick{} }))
	}
	return tea.Batch(cmds...)
}

func (a *App) current() view { return a.tabs[a.active].v }

func (a *App) bodySize() (int, int) { return a.w, maxInt(3, a.h-4) }

func (a *App) switchTo(i int) tea.Cmd {
	if i < 0 || i >= len(a.tabs) || i == a.active {
		return nil
	}
	a.active = i
	return a.current().Activated()
}

func (a *App) quit() tea.Cmd {
	for _, t := range a.tabs {
		if c, ok := t.v.(interface{ Close() }); ok {
			c.Close()
		}
	}
	a.quitting = true
	return tea.Quit
}

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.w, a.h = msg.Width, msg.Height
		w, h := a.bodySize()
		for _, t := range a.tabs {
			t.v.SetSize(w, h)
		}
		return a, nil

	case refreshTick:
		var cmds []tea.Cmd
		if a.tabs[a.active].id == tabDashboard {
			cmds = append(cmds, a.dash.refresh())
		}
		cmds = append(cmds, tea.Tick(a.d.Refresh, func(time.Time) tea.Msg { return refreshTick{} }))
		return a, tea.Batch(cmds...)

	case tea.KeyMsg:
		k := msg.String()
		if k == "ctrl+c" {
			return a, a.quit()
		}
		if !a.current().Capturing() {
			switch k {
			case "q":
				return a, a.quit()
			case "?":
				a.showHelp = !a.showHelp
				return a, nil
			case "1", "2", "3":
				return a, a.switchTo(int(k[0] - '1'))
			case "]":
				return a, a.switchTo((a.active + 1) % len(a.tabs))
			case "[":
				return a, a.switchTo((a.active - 1 + len(a.tabs)) % len(a.tabs))
			}
		}
		return a, a.current().Update(msg)
	}

	// Asynchronous results go to every view: each one ignores messages that are not its own.
	cmds := make([]tea.Cmd, 0, len(a.tabs))
	for _, t := range a.tabs {
		if c := t.v.Update(msg); c != nil {
			cmds = append(cmds, c)
		}
	}
	return a, tea.Batch(cmds...)
}

func (a *App) header() string {
	brand := ui.Badge.Render(" nah ")
	where := ui.MutedText.Render(" " + a.d.Profile + " · " + a.d.Client.BaseURL)
	var tabs []string
	for i, t := range a.tabs {
		label := " " + string(rune('1'+i)) + " " + t.title + " "
		if i == a.active {
			tabs = append(tabs, lipgloss.NewStyle().Bold(true).Foreground(ui.Accent).Underline(true).Render(label))
		} else {
			tabs = append(tabs, ui.MutedText.Render(label))
		}
	}
	left := brand + where
	right := strings.Join(tabs, "")
	gap := a.w - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 1 {
		return left + "\n" + right
	}
	return left + strings.Repeat(" ", gap) + right
}

type helpKeys struct{ short, full []key.Binding }

func (h helpKeys) ShortHelp() []key.Binding  { return h.short }
func (h helpKeys) FullHelp() [][]key.Binding { return [][]key.Binding{h.full} }

func (a *App) footer() string {
	global := []key.Binding{
		key.NewBinding(key.WithKeys("q"), key.WithHelp("q", "quit")),
		key.NewBinding(key.WithKeys("1"), key.WithHelp("1-"+string(rune('0'+len(a.tabs))), "tabs")),
		key.NewBinding(key.WithKeys("?"), key.WithHelp("?", "help")),
	}
	v := a.current()
	keys := append(append([]key.Binding{}, v.Help()...), global...)
	if v.Capturing() {
		keys = v.Help() // while typing, only show what applies
	}
	a.help.Width = a.w
	if a.showHelp {
		a.help.ShowAll = true
		return a.help.View(helpKeys{short: keys, full: keys})
	}
	a.help.ShowAll = false
	return a.help.View(helpKeys{short: keys})
}

func (a *App) View() string {
	if a.quitting {
		return ""
	}
	if a.w > 0 && (a.w < 60 || a.h < 14) {
		return "\n  Terminal too small (" + itoa(a.w) + "×" + itoa(a.h) + "). Please enlarge it to at least 60×14.\n"
	}
	_, bh := a.bodySize()
	body := lipgloss.NewStyle().Height(bh).MaxHeight(bh).Render(a.current().View())
	return a.header() + "\n\n" + body + "\n" + a.footer()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
