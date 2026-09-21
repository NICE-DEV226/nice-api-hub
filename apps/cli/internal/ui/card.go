package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// Colours of a card (a dialog): a filled panel a step lighter than the terminal, and the chips that sit on it.
var (
	CardBG = lipgloss.AdaptiveColor{Light: "#F1F4F7", Dark: "#262C34"}
	ChipBG = lipgloss.AdaptiveColor{Light: "#DCE2E8", Dark: "#3A424E"}
)

// CardRow pads text to inner cells on the card background, padX cells of margin on the left. Text that is too long is
// clipped, and any character that has no background gets the card's.
func CardRow(text string, inner, padX int) string {
	text = ansi.Truncate(text, maxInt(0, inner-padX), "")
	text = EnsureBG(text, CardBG)
	return lipgloss.NewStyle().Background(CardBG).PaddingLeft(padX).Width(inner).Render(text)
}

// Card draws rows (each already inner=width-2 cells wide, on CardBG) as a filled panel with softly cut corners.
func Card(rows []string, width int) string { return frame(rows, width, CardBG) }

// frame surrounds rows with quarter-block corners and half-block edges drawn in the fill colour, so the panel's outline
// sits half a cell inside its cells and looks rounded.
func frame(rows []string, width int, fill lipgloss.AdaptiveColor) string {
	inner := width - 2
	e := lipgloss.NewStyle().Foreground(fill)
	out := make([]string, 0, len(rows)+2)
	out = append(out, e.Render("▗"+strings.Repeat("▄", inner)+"▖"))
	for _, r := range rows {
		out = append(out, e.Render("▐")+r+e.Render("▌"))
	}
	out = append(out, e.Render("▝"+strings.Repeat("▀", inner)+"▘"))
	return strings.Join(out, "\n")
}
