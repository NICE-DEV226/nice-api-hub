package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
)

// Palette: neutral greys, ONE accent (blue), and colour only where it carries meaning (ok / warning / error).
// Values follow GitHub's Primer scale, which is tuned for legibility on both light and dark terminals.
// To rebrand the whole interface, change Accent here and nowhere else.
var (
	Accent   = lipgloss.AdaptiveColor{Light: "#0969DA", Dark: "#58A6FF"}
	Good     = lipgloss.AdaptiveColor{Light: "#1A7F37", Dark: "#3FB950"}
	Warn     = lipgloss.AdaptiveColor{Light: "#9A6700", Dark: "#D29922"}
	Bad      = lipgloss.AdaptiveColor{Light: "#CF222E", Dark: "#F85149"}
	Muted    = lipgloss.AdaptiveColor{Light: "#57606A", Dark: "#8B949E"}
	Subtle   = lipgloss.AdaptiveColor{Light: "#D0D7DE", Dark: "#30363D"}
	Text     = lipgloss.AdaptiveColor{Light: "#1F2328", Dark: "#E6EDF3"}
	OnAccent = lipgloss.AdaptiveColor{Light: "#FFFFFF", Dark: "#0D1117"}
)

// Reusable styles.
var (
	Title     = lipgloss.NewStyle().Bold(true).Foreground(Accent)
	Heading   = lipgloss.NewStyle().Bold(true).Foreground(Text)
	MutedText = lipgloss.NewStyle().Foreground(Muted)
	OK        = lipgloss.NewStyle().Foreground(Good)
	Warning   = lipgloss.NewStyle().Foreground(Warn)
	Danger    = lipgloss.NewStyle().Foreground(Bad)
	Bold      = lipgloss.NewStyle().Bold(true)
	Code      = lipgloss.NewStyle().Foreground(Accent)
	Badge     = lipgloss.NewStyle().Bold(true).Padding(0, 1).Foreground(OnAccent).Background(Accent)
	Panel     = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(Subtle).Padding(0, 1)
	PanelHot  = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(Accent).Padding(0, 1)
)

// StatusStyle colours a platform/account status word.
func StatusStyle(status string) lipgloss.Style {
	switch status {
	case "operational", "active", "succeeded", "delivered", "ready", "ok":
		return OK
	case "degraded", "queued", "running", "pending", "expired":
		return Warning
	case "down", "failed", "suspended", "revoked", "unavailable":
		return Danger
	}
	return MutedText
}

// Dot renders a coloured status bullet followed by the status word.
func Dot(status string) string {
	return StatusStyle(status).Render("● " + status)
}

// KV renders aligned "key  value" lines.
func KV(pairs ...[2]string) string {
	w := 0
	for _, p := range pairs {
		if n := lipgloss.Width(p[0]); n > w {
			w = n
		}
	}
	var b strings.Builder
	for i, p := range pairs {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(MutedText.Render(p[0]) + strings.Repeat(" ", w-lipgloss.Width(p[0])+2) + p[1])
	}
	return b.String()
}

// Table renders a compact table for non-interactive output.
func Table(headers []string, rows [][]string) string {
	t := table.New().
		Border(lipgloss.HiddenBorder()).
		BorderTop(false).BorderBottom(false).BorderLeft(false).BorderRight(false).
		BorderHeader(false).BorderColumn(false).BorderRow(false).
		Headers(headers...).
		Rows(rows...).
		StyleFunc(func(row, col int) lipgloss.Style {
			base := lipgloss.NewStyle().PaddingRight(2)
			if col == len(headers)-1 {
				base = lipgloss.NewStyle() // no trailing padding on the last column
			}
			if row == table.HeaderRow {
				return base.Bold(true).Foreground(Muted)
			}
			return base
		})
	lines := strings.Split(t.String(), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " ")
	}
	return strings.Join(lines, "\n")
}

// OneLine collapses whitespace (newlines included) and shortens s to max runes.
func OneLine(s string, max int) string {
	return Truncate(strings.Join(strings.Fields(s), " "), max)
}

// Bar renders a horizontal usage bar of the given width (used/total).
func Bar(used, total int64, width int) string {
	if width < 4 {
		width = 4
	}
	if total <= 0 {
		return MutedText.Render(strings.Repeat("░", width))
	}
	ratio := float64(used) / float64(total)
	if ratio > 1 {
		ratio = 1
	}
	filled := int(ratio*float64(width) + 0.5)
	style := OK
	switch {
	case ratio >= 0.9:
		style = Danger
	case ratio >= 0.7:
		style = Warning
	}
	return style.Render(strings.Repeat("█", filled)) + MutedText.Render(strings.Repeat("░", width-filled))
}
