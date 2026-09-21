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
	tabSetup
)

type tabInfo struct {
	id    tabID
	title string
	v     view
}

type refreshTick struct{}

// quitMsg asks the app to close (from a view: the welcome menu, a double Esc on the home screen).
type quitMsg struct{}

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

	setupMode bool

	// hit-testing for the mouse, refreshed by every render
	tabSpans [][2]int
	quitSpan [2]int // the clickable "Quit" at the right of the header
	tabRow   int
	bodyTop  int
}

// mouser is implemented by views that react to the mouse; coordinates are relative to the body's top-left.
type mouser interface {
	Mouse(msg tea.MouseMsg) tea.Cmd
}

// NewApp builds the interface for the given capabilities. A computer with no credentials at all gets the
// setup screen instead of tabs.
func NewApp(d Deps) *App {
	a := &App{help: help.New()}
	a.build(d)
	return a
}

func (a *App) build(d Deps) {
	d.defaults()
	a.d = d
	a.tabs, a.active, a.setupMode = nil, 0, false
	if d.Session != nil && !d.HasAPI && !d.HasAdmin {
		a.setupMode = true
		a.tabs = []tabInfo{{tabSetup, "Welcome", newSetup(d)}}
		return
	}
	a.dash = newDashboard(d)
	a.tabs = append(a.tabs, tabInfo{tabDashboard, "Dashboard", a.dash})
	if d.HasAdmin {
		a.tabs = append(a.tabs, tabInfo{tabAccounts, "Accounts", newAccounts(d)})
	}
	if d.HasAPI {
		a.tabs = append(a.tabs, tabInfo{tabPlayground, "Download", newPlayground(d)})
		a.active = len(a.tabs) - 1 // open on what the person came for: pasting a link
	}
}

// rebuild swaps in new dependencies (after setup) and starts the new views.
func (a *App) rebuild(d Deps) tea.Cmd {
	for _, t := range a.tabs {
		if c, ok := t.v.(interface{ Close() }); ok {
			c.Close()
		}
	}
	a.build(d)
	w, h := a.bodySize()
	for _, t := range a.tabs {
		t.v.SetSize(w, h)
	}
	return tea.Batch(a.Init(), a.current().Activated())
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

// maxContentWidth keeps the screens readable on wide terminals: past this, extra columns would only push things
// apart. The column is centred; the header and the key hints still span the whole window.
const maxContentWidth = 104

func (a *App) bodyWidth() int {
	if a.setupMode { // the welcome screen centres itself
		return a.w
	}
	return minInt(a.w, maxContentWidth)
}

func (a *App) bodySize() (int, int) { return a.bodyWidth(), maxInt(3, a.h-4) }

// bodyLeft is the number of blank columns to the left of the content column.
func (a *App) bodyLeft() int { return (a.w - a.bodyWidth()) / 2 }

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

	case tea.MouseMsg:
		return a, a.onMouse(msg)

	case quitMsg:
		return a, a.quit()

	case setupDoneMsg:
		d, err := a.d.Session.Reload()
		if err != nil {
			return a, nil
		}
		return a, a.rebuild(d)

	case tea.KeyMsg:
		k := msg.String()
		if k == "ctrl+c" {
			return a, a.quit()
		}
		if k == "ctrl+r" { // round the corners of pills and the input (needs a Nerd Font); remembered
			ui.RoundCaps = !ui.RoundCaps
			if a.d.Session != nil {
				_ = a.d.Session.SetRounded(ui.RoundCaps)
			}
			return a, nil
		}
		if !a.current().Capturing() {
			switch k {
			case "q":
				return a, a.quit()
			case "?":
				a.showHelp = !a.showHelp
				return a, nil
			case "s":
				// an operator with no account of their own can set this computer up from here
				if !a.d.HasAPI && a.d.Session != nil && !a.setupMode {
					a.setupMode = true
					su := newSetup(a.d)
					a.tabs = append(a.tabs, tabInfo{tabSetup, "Setup", su})
					a.active = len(a.tabs) - 1
					w, h := a.bodySize()
					su.SetSize(w, h)
					return a, su.Init()
				}
			case "1", "2", "3", "4", "5", "6":
				if len(a.tabs) > 1 {
					return a, a.switchTo(int(k[0] - '1'))
				}
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

func (a *App) onMouse(msg tea.MouseMsg) tea.Cmd {
	if isLeftClick(msg) && msg.Y < a.bodyTop {
		if msg.Y == a.tabRow && msg.X >= a.quitSpan[0] && msg.X < a.quitSpan[1] {
			return a.quit()
		}
		if msg.Y == a.tabRow {
			for i, sp := range a.tabSpans {
				if msg.X >= sp[0] && msg.X < sp[1] {
					return a.switchTo(i)
				}
			}
		}
		return nil
	}
	if msg.Y < a.bodyTop {
		return nil
	}
	if m, ok := a.current().(mouser); ok {
		msg.Y -= a.bodyTop
		msg.X -= a.bodyLeft()
		if msg.X < 0 || msg.X >= a.bodyWidth() {
			return nil
		}
		return m.Mouse(msg)
	}
	return nil
}

func (a *App) header() string {
	brand := ui.Badge.Render(" nah ")
	where := ui.MutedText.Render(" " + a.d.Profile + " · " + a.d.Client.BaseURL)
	left := brand + where

	labels := make([]string, len(a.tabs))
	widths := 0
	if !a.setupMode {
		for i, t := range a.tabs {
			labels[i] = " " + string(rune('1'+i)) + " " + t.title + " "
			widths += lipgloss.Width(labels[i])
		}
	}
	const quitLabel = "  × Quit "
	quitW := lipgloss.Width(quitLabel)
	total := widths + quitW
	oneLine := a.setupMode || a.w-lipgloss.Width(left)-total >= 1

	// x where the right-hand strip (tabs, then Quit) starts
	x := 0
	if oneLine {
		x = a.w - total
	}
	a.tabSpans = a.tabSpans[:0]
	var tabs []string
	for i, l := range labels {
		if a.setupMode {
			break
		}
		w := lipgloss.Width(l)
		a.tabSpans = append(a.tabSpans, [2]int{x, x + w})
		x += w
		if i == a.active {
			tabs = append(tabs, lipgloss.NewStyle().Bold(true).Foreground(ui.Accent).Underline(true).Render(l))
		} else {
			tabs = append(tabs, ui.MutedText.Render(l))
		}
	}
	a.quitSpan = [2]int{x + 2, x + quitW - 1} // the two blank cells before "×" are not part of the button
	right := strings.Join(tabs, "") + ui.MutedText.Render(quitLabel)
	if !oneLine {
		a.tabRow, a.bodyTop = 1, 3
		return left + "\n" + right
	}
	a.tabRow, a.bodyTop = 0, 2
	return left + strings.Repeat(" ", a.w-lipgloss.Width(left)-total) + right
}

type helpKeys struct{ short, full []key.Binding }

func (h helpKeys) ShortHelp() []key.Binding  { return h.short }
func (h helpKeys) FullHelp() [][]key.Binding { return [][]key.Binding{h.full} }

func (a *App) footer() string {
	global := []key.Binding{key.NewBinding(key.WithKeys("q"), key.WithHelp("q", "quit"))}
	if len(a.tabs) > 1 {
		global = append(global, key.NewBinding(key.WithKeys("1"), key.WithHelp("1-"+string(rune('0'+len(a.tabs))), "tabs (or click)")))
	}
	if !a.d.HasAPI && a.d.Session != nil && !a.setupMode {
		global = append(global, key.NewBinding(key.WithKeys("s"), key.WithHelp("s", "set up my account")))
	}
	global = append(global, key.NewBinding(key.WithKeys("ctrl+r"), key.WithHelp("ctrl+r", "round corners")))
	global = append(global, key.NewBinding(key.WithKeys("?"), key.WithHelp("?", "help")))
	v := a.current()
	keys := append(append([]key.Binding{}, v.Help()...), global...)
	if v.Capturing() {
		// while typing, only what applies, plus the one way out that always works
		keys = append(append([]key.Binding{}, v.Help()...), key.NewBinding(key.WithKeys("ctrl+c"), key.WithHelp("ctrl+c", "quit")))
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
	if left := a.bodyLeft(); left > 0 {
		body = indent(body, strings.Repeat(" ", left))
	}
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
