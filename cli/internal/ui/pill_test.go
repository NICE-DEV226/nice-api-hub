package ui

import (
	"regexp"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

var sgr = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func TestPillHasTheSameWidthWithAndWithoutRoundCaps(t *testing.T) {
	defer func(v bool) { RoundCaps = v }(RoundCaps)
	for _, mk := range []func() string{
		func() string { return Pill("Save here", Subtle, Text) },
		func() string { return KeyPill("enter", "Save here") },
	} {
		RoundCaps = false
		flat := lipgloss.Width(mk())
		RoundCaps = true
		if round := lipgloss.Width(mk()); flat != round {
			t.Fatalf("flat %d round %d", flat, round)
		}
	}
	RoundCaps = false
	if got := lipgloss.Width(KeyPill("tab", "Change")); got != len("tab Change")+2 {
		t.Fatal(got)
	}
}

func TestEveryCellOfAButtonCarriesTheFill(t *testing.T) {
	// a label printed after a styled key used to lose the background, leaving a dark hole at the end of the button
	prev := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor)
	defer lipgloss.SetColorProfile(prev)
	defer func(v bool) { RoundCaps = v }(RoundCaps)
	RoundCaps = false

	out := KeyPill("tab", "Change")
	hasBg := false
	for i := 0; i < len(out); {
		if loc := sgr.FindStringIndex(out[i:]); loc != nil && loc[0] == 0 {
			code := out[i : i+loc[1]]
			switch {
			case code == "\x1b[0m":
				hasBg = false
			case strings.Contains(code, "48;"):
				hasBg = true
			}
			i += loc[1]
			continue
		}
		if !hasBg {
			t.Fatalf("the character at %d (%q) is drawn without the fill:\n%q", i, out[i], out)
		}
		i++
	}
}
