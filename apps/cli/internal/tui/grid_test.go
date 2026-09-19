package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func rowsN(n int) [][]string {
	rows := make([][]string, n)
	for i := range rows {
		rows[i] = []string{fmt.Sprintf("row-%d", i), "x"}
	}
	return rows
}

func newTestGrid(n, h int) *grid {
	g := newGrid([]string{"NAME", "V"}, []int{0, 4})
	g.SetSize(30, h)
	g.SetRows(rowsN(n))
	return g
}

func TestGridNeverExceedsItsSizeAndKeepsTheCursorVisible(t *testing.T) {
	g := newTestGrid(50, 8) // 6 data rows
	for _, k := range []string{"down", "down", "pgdown", "pgdown", "end", "up", "home", "pgdown", "down"} {
		g.Key(k)
		out := g.View()
		if lines := strings.Split(out, "\n"); len(lines) > 8 {
			t.Fatalf("after %s: %d lines", k, len(lines))
		}
		for _, l := range strings.Split(out, "\n") {
			if w := lipgloss.Width(l); w > 30 {
				t.Fatalf("after %s: line %d wide: %q", k, w, l)
			}
		}
		if !strings.Contains(out, fmt.Sprintf("row-%d ", g.Cursor())) && g.Cursor() != 0 {
			t.Fatalf("after %s: cursor row %d not visible:\n%s", k, g.Cursor(), out)
		}
	}
}

func TestGridClickMapsPositionsToRowsEvenWhenScrolled(t *testing.T) {
	g := newTestGrid(50, 8)
	if _, ok := g.Click(3, 0); ok {
		t.Fatal("the header is not a row")
	}
	if _, ok := g.Click(3, 1); ok {
		t.Fatal("the rule is not a row")
	}
	if r, ok := g.Click(3, 2); !ok || r != 0 {
		t.Fatalf("first row: %d %v", r, ok)
	}
	g.SetCursor(40) // scrolls
	off := g.offset
	if off == 0 {
		t.Fatal("expected a scrolled grid")
	}
	if r, ok := g.Click(3, 4); !ok || r != off+2 {
		t.Fatalf("scrolled click: %d %v (offset %d)", r, ok, off)
	}
	if _, ok := g.Click(3, 8); ok {
		t.Fatal("below the grid")
	}
	if _, ok := g.Click(31, 3); ok {
		t.Fatal("right of the grid")
	}
	// fewer rows than space: empty area is not a row
	small := newTestGrid(2, 8)
	if _, ok := small.Click(3, 5); ok {
		t.Fatal("empty space is not a row")
	}
}

func TestGridWheelAndClamping(t *testing.T) {
	g := newTestGrid(5, 8)
	g.Wheel(3)
	if g.Cursor() != 3 {
		t.Fatal(g.Cursor())
	}
	g.Wheel(100)
	if g.Cursor() != 4 {
		t.Fatal("clamped to the last row")
	}
	g.Wheel(-100)
	if g.Cursor() != 0 {
		t.Fatal("clamped to the first row")
	}
	empty := newTestGrid(0, 8)
	empty.Key("down")
	empty.Wheel(1)
	if empty.Cursor() != 0 || !strings.Contains(empty.View(), "NAME") {
		t.Fatal("an empty grid must not break")
	}
	g.SetRows(rowsN(2)) // shrinking keeps the cursor valid
	g.SetCursor(4)
	if g.Cursor() != 1 {
		t.Fatal(g.Cursor())
	}
}

func TestGridTruncatesWideAndMultibyteCells(t *testing.T) {
	g := newGrid([]string{"A"}, []int{0})
	g.SetSize(20, 5)
	g.SetRows([][]string{{"héllo wörld 🎬 this is a very long title\nwith newline"}})
	for _, l := range strings.Split(g.View(), "\n") {
		if lipgloss.Width(l) > 20 {
			t.Fatalf("too wide: %q", l)
		}
	}
}

func TestActionBarHitTesting(t *testing.T) {
	var b actionBar
	out := b.Render([]action{{"d", "Download"}, {"m", "MP3"}, {"esc", "Back"}})
	total := lipgloss.Width(out)
	if k, ok := b.Hit(1); !ok || k != "d" {
		t.Fatalf("first button: %q %v", k, ok)
	}
	if _, ok := b.Hit(total + 5); ok {
		t.Fatal("outside")
	}
	// every column of the rendered line belongs to at most one button, in order
	var seen []string
	for x := 0; x < total; x++ {
		if k, ok := b.Hit(x); ok && (len(seen) == 0 || seen[len(seen)-1] != k) {
			seen = append(seen, k)
		}
	}
	if strings.Join(seen, ",") != "d,m,esc" {
		t.Fatalf("%v", seen)
	}
	if got := keyMsg("enter"); got.Type != tea.KeyEnter {
		t.Fatal(got)
	}
	if got := keyMsg("m"); got.String() != "m" {
		t.Fatal(got)
	}
}
