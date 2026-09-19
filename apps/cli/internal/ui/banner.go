package ui

import "github.com/charmbracelet/lipgloss"

// bannerArt is "NAH" in a block face. Every line has the same width.
var bannerArt = []string{
	"███╗   ██╗ █████╗ ██╗  ██╗",
	"████╗  ██║██╔══██╗██║  ██║",
	"██╔██╗ ██║███████║███████║",
	"██║╚██╗██║██╔══██║██╔══██║",
	"██║ ╚████║██║  ██║██║  ██║",
	"╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝",
}

// BannerWidth and BannerHeight are the size of the art.
const (
	BannerWidth  = 26
	BannerHeight = 6
)

// Tagline sits under the banner.
const Tagline = "grab any video, from your terminal"

// Banner returns the big "NAH" logo as lines, in one flat colour (the accent). No colour support, no escapes.
func Banner() []string {
	style := lipgloss.NewStyle().Bold(true).Foreground(Accent)
	out := make([]string, len(bannerArt))
	for i, l := range bannerArt {
		out[i] = style.Render(l)
	}
	return out
}
