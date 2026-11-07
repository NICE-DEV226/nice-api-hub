package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/history"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/opener"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

type historyLoadedMsg struct {
	entries []history.Entry
	err     error
}

type historyView struct {
	d       Deps
	w, h    int
	loaded  bool
	loading bool
	err     error

	entries  []history.Entry
	filtered []history.Entry
	table    *grid

	filterIn  textinput.Model
	filtering bool

	confirm struct {
		active bool
		prompt string
		run    func() tea.Cmd
	}

	toast flash
	leftW int
}

func newHistoryView(d Deps) *historyView {
	fi := textinput.New()
	fi.Placeholder = "type to filter…"
	fi.Prompt = "/ "
	fi.PromptStyle = ui.Title
	fi.CharLimit = 60

	v := &historyView{
		d:        d,
		filterIn: fi,
	}
	v.table = newGrid([]string{"WHEN", "TITLE", "QUALITY", "SIZE", "SITE"}, []int{10, 0, 7, 8, 9}).Right(3)
	return v
}

func (v *historyView) Init() tea.Cmd {
	return v.reload()
}

func (v *historyView) Activated() tea.Cmd {
	return v.reload()
}

func (v *historyView) reload() tea.Cmd {
	v.loading = true
	st := v.d.History
	return func() tea.Msg {
		if st == nil {
			return historyLoadedMsg{entries: nil, err: nil}
		}
		entries, err := st.List()
		return historyLoadedMsg{entries: entries, err: err}
	}
}

func (v *historyView) selected() *history.Entry {
	i := v.table.Cursor()
	if i < 0 || i >= len(v.filtered) {
		return nil
	}
	return &v.filtered[i]
}

func (v *historyView) applyFilter() {
	query := strings.ToLower(strings.TrimSpace(v.filterIn.Value()))
	if query == "" {
		v.filtered = make([]history.Entry, len(v.entries))
		copy(v.filtered, v.entries)
	} else {
		v.filtered = nil
		for _, e := range v.entries {
			if strings.Contains(strings.ToLower(e.Title), query) ||
				strings.Contains(strings.ToLower(e.Platform), query) ||
				strings.Contains(strings.ToLower(e.URL), query) ||
				strings.Contains(strings.ToLower(e.Label()), query) {
				v.filtered = append(v.filtered, e)
			}
		}
	}
	v.rebuildRows()
}

func (v *historyView) rebuildRows() {
	now := v.d.Now()
	rows := make([][]string, len(v.filtered))
	for i, e := range v.filtered {
		size := "—"
		if e.Bytes > 0 {
			size = ui.Bytes(e.Bytes)
		}
		title := e.Title
		if title == "" {
			title = e.URL
		}
		if !e.Exists() {
			title += " (moved)"
		}
		rows[i] = []string{
			ui.Ago(e.At, now),
			ui.Truncate(title, 60),
			e.Label(),
			size,
			e.Platform,
		}
	}
	v.table.SetRows(rows)
	if v.table.Cursor() >= len(rows) {
		v.table.SetCursor(maxInt(0, len(rows)-1))
	}
}

func (v *historyView) SetSize(w, h int) {
	v.w, v.h = w, h
	leftW := maxInt(38, w*3/5)
	v.leftW = leftW
	v.table.SetSize(leftW-2, maxInt(4, h-4))
}

func (v *historyView) Capturing() bool {
	return v.filtering
}

func (v *historyView) Help() []key.Binding {
	return []key.Binding{
		key.NewBinding(key.WithKeys("c"), key.WithHelp("c", "copy URL")),
		key.NewBinding(key.WithKeys("o"), key.WithHelp("o", "open file / folder")),
		key.NewBinding(key.WithKeys("x"), key.WithHelp("x", "delete entry")),
		key.NewBinding(key.WithKeys("C"), key.WithHelp("C", "clear history")),
		key.NewBinding(key.WithKeys("/"), key.WithHelp("/", "filter")),
	}
}

func (v *historyView) Update(msg tea.Msg) tea.Cmd {
	now := v.d.Now()
	switch msg := msg.(type) {
	case historyLoadedMsg:
		v.loading = false
		if msg.err != nil {
			v.err = msg.err
			return nil
		}
		v.err, v.loaded, v.entries = nil, true, msg.entries
		v.applyFilter()
		return nil

	case tea.KeyMsg:
		return v.onKey(msg)
	}
	_ = now
	return nil
}

func (v *historyView) onKey(msg tea.KeyMsg) tea.Cmd {
	now := v.d.Now()
	k := msg.String()

	if v.confirm.active {
		switch k {
		case "y", "Y":
			run := v.confirm.run
			v.confirm.active = false
			v.confirm.run = nil
			if run != nil {
				return run()
			}
		default:
			v.confirm.active = false
			v.confirm.run = nil
		}
		return nil
	}

	if v.filtering {
		switch k {
		case "esc", "enter":
			v.filtering = false
			return nil
		default:
			var cmd tea.Cmd
			v.filterIn, cmd = v.filterIn.Update(msg)
			v.applyFilter()
			return cmd
		}
	}

	switch k {
	case "/":
		v.filtering = true
		v.filterIn.Focus()
		return textinput.Blink
	case "c":
		sel := v.selected()
		if sel == nil {
			return nil
		}
		v.toast.set(now, "Copied URL to clipboard: "+sel.URL, false)
		if v.d.Copy != nil {
			return v.d.Copy(sel.URL)
		}
		return nil
	case "o":
		sel := v.selected()
		if sel == nil {
			return nil
		}
		if !sel.Exists() {
			v.toast.set(now, "File moved or deleted: "+sel.Path, true)
			return nil
		}
		if err := opener.Reveal(sel.Path); err != nil {
			v.toast.set(now, "Could not open: "+err.Error(), true)
		} else {
			v.toast.set(now, "Opened folder in file manager", false)
		}
		return nil
	case "x", "d":
		sel := v.selected()
		if sel == nil {
			return nil
		}
		id := sel.ID
		title := sel.Title
		if title == "" {
			title = sel.URL
		}
		v.confirm.active = true
		v.confirm.prompt = fmt.Sprintf("Remove %q from history?", ui.Truncate(title, 40))
		v.confirm.run = func() tea.Cmd {
			if v.d.History != nil {
				_ = v.d.History.Remove(id)
			}
			v.toast.set(v.d.Now(), "Entry removed from history", false)
			return v.reload()
		}
		return nil
	case "C":
		if len(v.entries) == 0 {
			return nil
		}
		v.confirm.active = true
		v.confirm.prompt = "Clear all download history? (Downloaded files are not touched)"
		v.confirm.run = func() tea.Cmd {
			if v.d.History != nil {
				_ = v.d.History.Clear()
			}
			v.toast.set(v.d.Now(), "History cleared", false)
			return v.reload()
		}
		return nil
	}

	v.table.Key(k)
	return nil
}

func (v *historyView) Mouse(msg tea.MouseMsg) tea.Cmd {
	if v.confirm.active || v.filtering || !v.loaded {
		return nil
	}
	if d := wheelDelta(msg); d != 0 {
		v.table.Wheel(d)
		return nil
	}
	if !isLeftClick(msg) {
		return nil
	}
	if row, ok := v.table.Click(msg.X-2, msg.Y-2); ok {
		v.table.SetCursor(row)
	}
	return nil
}

func (v *historyView) View() string {
	if v.err != nil {
		return ui.Panel.Render(ui.Danger.Render("✗ ") + wrap(v.err.Error(), minInt(80, v.w-6)))
	}
	if !v.loaded {
		return "Loading history…"
	}

	leftW := maxInt(38, v.w*3/5)
	v.leftW = leftW
	rightW := v.w - leftW - 1

	headerTitle := fmt.Sprintf("Downloads (%d)", len(v.filtered))
	if v.filterIn.Value() != "" {
		headerTitle += fmt.Sprintf(" · filter: %q", v.filterIn.Value())
	}

	leftContent := v.table.View()
	if len(v.filtered) == 0 {
		if len(v.entries) == 0 {
			leftContent = ui.MutedText.Render("Nothing downloaded yet.\nDownloads from this computer will appear here.")
		} else {
			leftContent = ui.MutedText.Render("No downloads match the current filter.")
		}
	}
	if v.filtering {
		leftContent = v.filterIn.View() + "\n\n" + leftContent
	}

	left := panelFocus(headerTitle, leftContent, leftW, v.h-2, true)
	right := v.detailView(rightW)
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, " ", right)

	if v.confirm.active {
		return overlay(v.w, v.h, ui.PanelHot.Render(ui.Warning.Render("Confirm")+"\n\n"+wrap(v.confirm.prompt, 52)+"\n\n"+ui.MutedText.Render("y yes · any other key cancels")))
	}

	if v.toast.visible(v.d.Now()) {
		style := ui.OK
		if v.toast.bad {
			style = ui.Danger
		}
		body += "\n" + style.Render(ui.Truncate(v.toast.text, v.w-2))
	}
	return body
}

func (v *historyView) detailView(w int) string {
	sel := v.selected()
	if sel == nil {
		return panelFocus("Details", ui.MutedText.Render("Select a download to inspect details."), w, v.h-2, false)
	}

	var sb strings.Builder
	sb.WriteString(ui.Title.Render(ui.Truncate(sel.Title, w-6)) + "\n\n")

	sizeStr := "—"
	if sel.Bytes > 0 {
		sizeStr = ui.Bytes(sel.Bytes)
	}
	sb.WriteString(ui.KV(
		[2]string{"url", ui.MutedText.Render(ui.Truncate(sel.URL, w-12))},
		[2]string{"site", sel.Platform},
		[2]string{"quality", sel.Label()},
		[2]string{"size", sizeStr},
		[2]string{"when", sel.At.Local().Format("2006-01-02 15:04:05")},
	) + "\n\n")

	sb.WriteString(ui.MutedText.Render("saved path") + "\n")
	sb.WriteString(ui.MutedText.Render(wrap(sel.Path, w-6)) + "\n\n")

	if sel.Exists() {
		sb.WriteString(ui.OK.Render("✓ File exists on disk") + "\n")
	} else {
		sb.WriteString(ui.Danger.Render("✗ File moved or deleted") + "\n")
	}

	sb.WriteString("\n" + ui.MutedText.Render("c copy URL · o open folder\nx delete · C clear all · / filter"))
	return panelFocus("Details", sb.String(), w, v.h-2, false)
}
