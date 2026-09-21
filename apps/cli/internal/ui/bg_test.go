package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func trueColor(t *testing.T) {
	prev := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() { lipgloss.SetColorProfile(prev) })
}

func TestEnsureBGFillsThePaddingAWidgetLeavesBare(t *testing.T) {
	trueColor(t)
	// what the text input printed in the placeholder state: a styled run, then a reset, then bare spaces
	in := "\x1b[7mP\x1b[0m\x1b[38;2;139;147;158;48;2;54;62;73maste\x1b[0m" + strings.Repeat(" ", 20)
	if got := BareText(in); strings.TrimSpace(got) != "" || len(got) != 20 {
		t.Fatalf("the input has bare spaces to begin with: %q", got)
	}
	out := EnsureBG(in, FieldBG)
	if got := BareText(out); got != "" {
		t.Fatalf("every character must carry a background, still bare: %q\n%q", got, out)
	}
	if !strings.Contains(out, "\x1b[7mP") {
		t.Fatal("a cursor drawn in reverse video must be left as it was")
	}
	if strings.Count(out, "aste") != 1 {
		t.Fatal("the text itself must not change")
	}
}

func TestEnsureBGLeavesTextThatAlreadyHasABackground(t *testing.T) {
	trueColor(t)
	in := lipgloss.NewStyle().Background(lipgloss.Color("#123456")).Render("ok")
	out := EnsureBG(in, FieldBG)
	if strings.Count(out, "48;") != strings.Count(in, "48;") {
		t.Fatalf("no second background must be added: %q -> %q", in, out)
	}
}

func TestEnsureBGDoesNotMistakeColourComponentsForAttributes(t *testing.T) {
	trueColor(t)
	// 38;2;7;49;48 has the numbers 7, 49 and 48 as RGB components: they are not "reverse", "reset background"…
	in := "\x1b[38;2;7;49;48mtext\x1b[0m"
	out := EnsureBG(in, FieldBG)
	if !strings.Contains(out, "\x1b[49m") || BareText(out) != "" {
		t.Fatalf("%q", out)
	}
}

func TestEnsureBGIsANoOpWithoutColour(t *testing.T) {
	prev := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.Ascii)
	defer lipgloss.SetColorProfile(prev)
	if got := EnsureBG("plain text", FieldBG); got != "plain text" {
		t.Fatalf("%q", got)
	}
}
