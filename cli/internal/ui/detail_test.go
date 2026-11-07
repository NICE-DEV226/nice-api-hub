package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestAlignedRightAlignsValues(t *testing.T) {
	out := Aligned([2]string{"requests", "250"}, [2]string{"cache hits", "40"}, [2]string{"errors", "3"})
	lines := strings.Split(out, "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(lines))
	}
	// every value must end at the same column
	end := -1
	for _, l := range lines {
		e := lipgloss.Width(l)
		if end == -1 {
			end = e
		} else if e != end {
			t.Fatalf("values do not share a right edge: %d vs %d in %q", end, e, l)
		}
	}
	if !strings.Contains(out, "cache hits") || !strings.Contains(out, "250") {
		t.Fatalf("missing content: %q", out)
	}
}

func TestMetricRendersValueOverLabel(t *testing.T) {
	out := Metric("250", "requests today")
	lines := strings.Split(out, "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], "250") || !strings.Contains(lines[1], "requests today") {
		t.Fatalf("unexpected metric: %q", out)
	}
}

func TestMetricsPlacesTilesSideBySide(t *testing.T) {
	out := Metrics(4, [2]string{"250", "requests"}, [2]string{"40", "cache hits"})
	lines := strings.Split(out, "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines for 2 tiles, got %d: %q", len(lines), out)
	}
	// second tile's value sits on line 1, its label on line 2, right of the first tile
	if !strings.Contains(lines[0], "40") || !strings.Contains(lines[1], "cache hits") {
		t.Fatalf("second tile missing or misplaced: %q", out)
	}
	if strings.Index(lines[1], "cache hits") <= strings.Index(lines[1], "requests") {
		t.Fatalf("tiles are not side by side: %q", lines[1])
	}
}
