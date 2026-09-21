package ui

import (
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// Fill of an input field, a step away from the terminal background; a little lighter while it has focus.
var (
	FieldBG      = lipgloss.AdaptiveColor{Light: "#EAEEF2", Dark: "#2B313A"}
	FieldBGFocus = lipgloss.AdaptiveColor{Light: "#DDE3EA", Dark: "#363E4A"}
)

func fieldFill(focused bool) lipgloss.AdaptiveColor {
	if focused {
		return FieldBGFocus
	}
	return FieldBG
}

// FieldText styles text that sits on the field, so its background matches the fill.
func FieldText(s lipgloss.Style, focused bool) lipgloss.Style {
	return s.Background(fieldFill(focused))
}

// FieldRow pads text to inner cells on the field background, with padX cells of margin on the left. Text that is too
// long is clipped: wrapping would add lines and push the cursor away.
func FieldRow(text string, inner, padX int, focused bool) string {
	text = ansi.Truncate(text, maxInt(0, inner-padX), "") // wrapping would add lines: clip instead
	text = EnsureBG(text, fieldFill(focused))             // the input pads with bare spaces: give them the fill too
	return lipgloss.NewStyle().Background(fieldFill(focused)).PaddingLeft(padX).Width(inner).Render(text)
}

// Field draws the input field, width cells wide. content is one line already sized by FieldRow to width-2 cells.
//
// By default it is a filled block whose corners are cut with quarter blocks: it works in every font. A terminal cell
// is a rectangle, so a truly round corner needs a special glyph; with RoundCaps on, the field is a real pill with
// half-circle ends. tall adds breathing room above and below the text.
func Field(content string, width int, focused, tall bool) string {
	if width < 6 {
		width = 6
	}
	inner := width - 2
	fill := fieldFill(focused)
	if RoundCaps {
		c := lipgloss.NewStyle().Foreground(fill)
		pill := c.Render(capLeft) + content + c.Render(capRight)
		if tall {
			return "\n" + pill + "\n"
		}
		return pill
	}
	blank := FieldRow("", inner, 0, focused)
	rows := []string{content}
	if tall {
		rows = []string{blank, content, blank}
	}
	return frame(rows, width, fill)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
