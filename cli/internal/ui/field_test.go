package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestFieldIsRectangularInTheDefaultMode(t *testing.T) {
	defer func(v bool) { RoundCaps = v }(RoundCaps)
	RoundCaps = false
	inner := 38
	for _, tall := range []bool{false, true} {
		out := Field(FieldRow("hello", inner, 2, true), inner+2, true, tall)
		lines := strings.Split(out, "\n")
		want := 3
		if tall {
			want = 5
		}
		if len(lines) != want {
			t.Fatalf("tall=%v: %d lines, want %d", tall, len(lines), want)
		}
		for i, l := range lines {
			if w := lipgloss.Width(l); w != inner+2 {
				t.Errorf("tall=%v line %d is %d wide, want %d", tall, i, w, inner+2)
			}
		}
		plain := func(s string) string { return sgr.ReplaceAllString(s, "") }
		if !strings.HasPrefix(plain(lines[0]), "▗▄") || !strings.HasSuffix(plain(lines[len(lines)-1]), "▀▘") {
			t.Fatalf("cut corners:\n%s\n%s", plain(lines[0]), plain(lines[len(lines)-1]))
		}
	}
}

func TestFieldIsARealPillWithRoundCaps(t *testing.T) {
	defer func(v bool) { RoundCaps = v }(RoundCaps)
	RoundCaps = true
	inner := 38
	pill := Field(FieldRow("hello", inner, 2, false), inner+2, false, false)
	if strings.Contains(pill, "\n") || lipgloss.Width(pill) != inner+2 {
		t.Fatalf("one row of the right width: %d", lipgloss.Width(pill))
	}
	tall := Field(FieldRow("hello", inner, 2, false), inner+2, false, true)
	if lines := strings.Split(tall, "\n"); len(lines) != 3 || lipgloss.Width(lines[1]) != inner+2 {
		t.Fatalf("tall is the pill with a spacer line above and below: %q", lines)
	}
}

func TestFieldRowNeverWrapsWhateverTheTextLength(t *testing.T) {
	long := strings.Repeat("x", 500)
	if got := FieldRow(long, 30, 2, false); strings.Contains(got, "\n") || lipgloss.Width(got) != 30 {
		t.Fatalf("width %d, newline=%v", lipgloss.Width(got), strings.Contains(got, "\n"))
	}
}

func TestFocusChangesTheFill(t *testing.T) {
	if fieldFill(true) == fieldFill(false) {
		t.Fatal("the focused field must look different from an idle one")
	}
}
