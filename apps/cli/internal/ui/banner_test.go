package ui

import (
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestBannerLinesShareOneWidthAndTheDeclaredSize(t *testing.T) {
	if len(bannerArt) != BannerHeight {
		t.Fatalf("height %d", len(bannerArt))
	}
	for i, l := range bannerArt {
		if w := lipgloss.Width(l); w != BannerWidth {
			t.Errorf("line %d is %d wide, want %d", i, w, BannerWidth)
		}
	}
	for i, l := range Banner() {
		if lipgloss.Width(l) != BannerWidth {
			t.Errorf("styled line %d is %d wide", i, lipgloss.Width(l))
		}
	}
}
