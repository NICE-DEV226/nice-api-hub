package tui

import (
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// panel draws a titled rounded box of the given outer width.
func panel(title, body string, width int) string {
	return panelNote(title, "", body, width)
}

// panelNote is panel with a muted note right-aligned in the header row (lazygit-style panel hints).
func panelNote(title, note, body string, width int) string {
	if width < 12 {
		width = 12
	}
	head := ui.Title.Render(title)
	if note != "" {
		// the Panel style adds a border and one cell of padding each side: usable text width is width-6
		inner := maxInt(4, width-6)
		avail := inner - lipgloss.Width(head) - 1
		if avail < 4 {
			avail = 4
		}
		noteR := ui.MutedText.Render(ui.Truncate(note, avail))
		gap := inner - lipgloss.Width(head) - lipgloss.Width(noteR)
		if gap < 1 {
			gap = 1
		}
		head += strings.Repeat(" ", gap) + noteR
	}
	return ui.Panel.Width(width - 2).Render(head + "\n" + body)
}

// detailMinWidth is the narrowest terminal where the master-detail split still leaves a usable
// detail pane; below it list views stack the detail under the list.
const detailMinWidth = 96

// panelFocus is panel with the highlight border while the pane has the keyboard focus.
func panelFocus(title, body string, width, height int, focused bool) string {
	style := ui.Panel
	if focused {
		style = ui.PanelHot
	}
	return style.Width(maxInt(12, width-2)).Height(maxInt(3, height-2)).Render(ui.Title.Render(title) + "\n" + body)
}

// confirmOverlay centres a yes/no prompt: warning title, question, muted hint.
func confirmOverlay(prompt string, w, h int) string {
	return overlay(w, h, ui.PanelHot.Render(ui.Warning.Render("Confirm")+"\n\n"+wrap(prompt, 52)+"\n\n"+ui.MutedText.Render("y yes · any other key cancels")))
}

// overlay centres box inside a w×h area.
func overlay(w, h int, box string) string {
	return lipgloss.Place(w, maxInt(h, lipgloss.Height(box)), lipgloss.Center, lipgloss.Center, box)
}

// wrap hard-wraps s to width columns.
func wrap(s string, width int) string {
	if width < 10 {
		return s
	}
	return lipgloss.NewStyle().Width(width).Render(s)
}

func indent(s, pad string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = pad + l
	}
	return strings.Join(lines, "\n")
}

func lipglossWidth(s string) int { return lipgloss.Width(s) }
