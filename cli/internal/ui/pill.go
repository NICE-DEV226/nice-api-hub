package ui

import (
	"os"

	"github.com/charmbracelet/lipgloss"
)

// RoundCaps draws buttons, chips and the input field as pills with half-circle ends. Those ends are private-use glyphs
// (Powerline / Nerd Fonts): without such a font they show as empty boxes, so this is opt-in. Turn it on with
// NAH_NERD_FONT=1, or press Ctrl+R in the interface (the choice is remembered).
var RoundCaps = os.Getenv("NAH_NERD_FONT") == "1"

const (
	capLeft  = "\ue0b6"
	capRight = "\ue0b4"
)

// wrapPill puts inner (already styled, on background bg) between two rounded caps, or between one cell of padding.
// The width is the same either way: two cells around the content. under is the colour behind the pill (a card's fill),
// or nil for the plain terminal: the cap glyphs are transparent at their corners, so they need it.
func wrapPill(inner string, bg, under lipgloss.TerminalColor) string {
	if RoundCaps {
		c := lipgloss.NewStyle().Foreground(bg)
		if under != nil {
			c = c.Background(under)
		}
		return c.Render(capLeft) + inner + c.Render(capRight)
	}
	pad := lipgloss.NewStyle().Background(bg).Render(" ")
	return pad + inner + pad
}

// Pill renders text on a filled background, rounded at both ends when RoundCaps is on.
func Pill(text string, bg, fg lipgloss.TerminalColor) string { return PillOn(text, bg, fg, nil) }

// PillOn is Pill sitting on a coloured surface.
func PillOn(text string, bg, fg, under lipgloss.TerminalColor) string {
	return wrapPill(lipgloss.NewStyle().Foreground(fg).Background(bg).Render(text), bg, under)
}

// PillBold is Pill with bold text.
func PillBold(text string, bg, fg lipgloss.TerminalColor) string {
	return PillBoldOn(text, bg, fg, nil)
}

// PillBoldOn is PillBold sitting on a coloured surface.
func PillBoldOn(text string, bg, fg, under lipgloss.TerminalColor) string {
	return wrapPill(lipgloss.NewStyle().Bold(true).Foreground(fg).Background(bg).Render(text), bg, under)
}

// KeyPill renders a keyboard shortcut and its label as one button: "tab  Change".
func KeyPill(key, label string) string { return KeyPillOn(key, label, Subtle, nil) }

// KeyPillOn is KeyPill with a chosen fill, sitting on a coloured surface.
func KeyPillOn(key, label string, bg, under lipgloss.TerminalColor) string {
	k := lipgloss.NewStyle().Bold(true).Foreground(Accent).Background(bg).Render(key)
	l := lipgloss.NewStyle().Foreground(Text).Background(bg).Render(" " + label)
	return wrapPill(k+l, bg, under)
}
