package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestBannerIsRectangularAndMadeOnlyOfBlocksAndSpaces(t *testing.T) {
	lines := bannerLines("NAH")
	if len(lines) != BannerHeight {
		t.Fatalf("height %d", len(lines))
	}
	for i, l := range lines {
		if w := lipgloss.Width(l); w != BannerWidth {
			t.Errorf("line %d is %d wide, want %d", i, w, BannerWidth)
		}
		if strings.Trim(l, "█ ") != "" {
			t.Errorf("line %d contains glyphs other than blocks: %q", i, l)
		}
	}
	for i, l := range Banner() {
		if lipgloss.Width(l) != BannerWidth {
			t.Errorf("styled line %d is %d wide", i, lipgloss.Width(l))
		}
	}
}

func TestEveryLetterHasFiveRowsOfFiveColumns(t *testing.T) {
	for r, rows := range letters {
		for i, row := range rows {
			if len(row) != 5 {
				t.Errorf("%c row %d: %q", r, i, row)
			}
		}
	}
}
