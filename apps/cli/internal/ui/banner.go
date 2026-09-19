package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// The logo is drawn with full blocks only, two cells per pixel. Box-drawing glyphs (the usual "shadow" ASCII
// fonts) render with different widths and overlaps in different terminal fonts; a full block never does.
var letters = map[rune][5]string{
	'N': {"X...X", "XX..X", "X.X.X", "X..XX", "X...X"},
	'A': {".XXX.", "X...X", "XXXXX", "X...X", "X...X"},
	'H': {"X...X", "X...X", "XXXXX", "X...X", "X...X"},
}

const (
	pixelOn  = "██"
	pixelOff = "  "
	// BannerHeight is the number of lines of the logo.
	BannerHeight = 5
)

// Tagline sits under the banner.
const Tagline = "grab any video, from your terminal"

func bannerLines(word string) []string {
	rows := make([]string, BannerHeight)
	for i := range rows {
		var b strings.Builder
		for n, r := range word {
			if n > 0 {
				b.WriteString(pixelOff + pixelOff) // gap between letters
			}
			for _, c := range letters[r][i] {
				if c == 'X' {
					b.WriteString(pixelOn)
				} else {
					b.WriteString(pixelOff)
				}
			}
		}
		rows[i] = b.String()
	}
	return rows
}

// BannerWidth is the width in cells of the "NAH" logo.
var BannerWidth = lipgloss.Width(bannerLines("NAH")[0])

// Banner returns the "NAH" logo as lines, in one flat colour (the accent). Without colour support: no escapes.
func Banner() []string {
	style := lipgloss.NewStyle().Foreground(Accent)
	lines := bannerLines("NAH")
	for i, l := range lines {
		lines[i] = style.Render(l)
	}
	return lines
}
