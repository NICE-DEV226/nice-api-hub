package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Aligned renders "label … value" rows: muted labels on the left and values
// right-aligned to a shared column, so numbers line up (k9s/btop detail panes).
func Aligned(pairs ...[2]string) string {
	lw, vw := 0, 0
	for _, p := range pairs {
		if n := lipgloss.Width(p[0]); n > lw {
			lw = n
		}
		if n := lipgloss.Width(p[1]); n > vw {
			vw = n
		}
	}
	var b strings.Builder
	for i, p := range pairs {
		if i > 0 {
			b.WriteByte('\n')
		}
		label := MutedText.Render(p[0]) + strings.Repeat(" ", lw-lipgloss.Width(p[0])+2)
		value := strings.Repeat(" ", vw-lipgloss.Width(p[1])) + p[1]
		b.WriteString(label + value)
	}
	return b.String()
}

// Metric renders a stat tile: a bold value over a muted label.
func Metric(value, label string) string {
	return Bold.Render(value) + "\n" + MutedText.Render(label)
}

// Metrics renders several Metric tiles on one line, top-aligned, gap cells apart.
func Metrics(gap int, tiles ...[2]string) string {
	parts := make([]string, 0, 2*len(tiles)-1)
	for i, t := range tiles {
		if i > 0 {
			parts = append(parts, strings.Repeat(" ", gap))
		}
		parts = append(parts, Metric(t[0], t[1]))
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, parts...)
}
