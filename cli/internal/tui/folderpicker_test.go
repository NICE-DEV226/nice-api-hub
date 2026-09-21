package tui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/fsnav"
)

// pickerEnv is a real file system rooted in a temp dir that plays the role of the home folder.
func pickerEnv(t *testing.T, dirs ...string) (fsnav.Env, string) {
	t.Helper()
	home := t.TempDir()
	for _, d := range dirs {
		if err := os.MkdirAll(filepath.Join(home, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	e := fsnav.System()
	e.Home = func() (string, error) { return home, nil }
	e.Getenv = func(string) string { return "" }
	return e, home
}

func typeText(p *folderPicker, s string) {
	for _, r := range s {
		p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
}

func rowLabels(p *folderPicker) []string {
	var out []string
	for _, r := range p.rows {
		switch r.kind {
		case rowSave:
			out = append(out, "SAVE")
		case rowUp:
			out = append(out, "UP")
		default:
			out = append(out, r.entry.Name)
		}
	}
	return out
}

func TestEnterThenEnterOpensAFolderAndSavesInIt(t *testing.T) {
	env, home := pickerEnv(t, "Downloads/Videos", "Downloads/Music", "Documents")
	p := newFolderPicker(env, filepath.Join(home, "Downloads"), "", nil)
	if got := strings.Join(rowLabels(p), ","); got != "SAVE,UP,Music,Videos" {
		t.Fatalf("rows: %s", got)
	}
	if p.current().kind != rowSave {
		t.Fatal("the cursor starts on 'Save in this folder'")
	}
	p.Update(keyMsg("down"))
	p.Update(keyMsg("down"))
	p.Update(keyMsg("down")) // Videos
	p.Update(keyMsg("enter"))
	if p.dir != filepath.Join(home, "Downloads", "Videos") || p.done {
		t.Fatalf("first Enter opens the folder: dir=%s done=%v", p.dir, p.done)
	}
	if p.current().kind != rowSave {
		t.Fatal("after entering, the cursor is back on 'Save in this folder'")
	}
	p.Update(keyMsg("enter"))
	if !p.done || p.chosen != filepath.Join(home, "Downloads", "Videos") {
		t.Fatalf("second Enter saves here: %+v", p)
	}
}

func TestTypingFiltersAndPutsTheCursorOnTheFirstMatch(t *testing.T) {
	env, home := pickerEnv(t, "Videos", "Vacation", "Music", "Old videos")
	p := newFolderPicker(env, home, "", nil)
	typeText(p, "vid")
	if got := strings.Join(rowLabels(p), ","); got != "SAVE,Videos,Old videos" {
		t.Fatalf("prefix matches come before substring matches: %s", got)
	}
	if p.current().entry.Name != "Videos" {
		t.Fatalf("cursor: %+v", p.current())
	}
	p.Update(keyMsg("backspace"))
	typeText(p, "d") // "vid" again after deleting one char: still filtering
	p.Update(keyMsg("enter"))
	if filepath.Base(p.dir) != "Videos" || p.filter != "" {
		t.Fatalf("Enter opens the match and clears the filter: %s %q", p.dir, p.filter)
	}
	// Esc clears a filter first, and only then cancels
	typeText(p, "zzz")
	p.Update(keyMsg("esc"))
	if p.filter != "" || p.done {
		t.Fatal("first Esc clears the filter")
	}
	p.Update(keyMsg("esc"))
	if !p.done || p.chosen != "" {
		t.Fatal("second Esc cancels")
	}
}

func TestBackspaceOnAnEmptyFilterGoesUpAndLeftToo(t *testing.T) {
	env, home := pickerEnv(t, "a/b")
	p := newFolderPicker(env, filepath.Join(home, "a", "b"), "", nil)
	p.Update(keyMsg("backspace"))
	if p.dir != filepath.Join(home, "a") {
		t.Fatal(p.dir)
	}
	p.Update(keyMsg("left"))
	if p.dir != home {
		t.Fatal(p.dir)
	}
	p.Update(keyMsg("down")) // UP row
	p.Update(keyMsg("enter"))
	if p.dir != filepath.Dir(home) {
		t.Fatalf("the '..' row goes up: %s", p.dir)
	}
}

func TestTypingAPathCompletesWithTabAndJumpsWithEnter(t *testing.T) {
	env, home := pickerEnv(t, "Music/Rock", "Videos")
	p := newFolderPicker(env, home, "", nil)
	typeText(p, "~/Mu")
	p.Update(keyMsg("tab"))
	if p.filter != "~/Music/" {
		t.Fatalf("completed: %q", p.filter)
	}
	typeText(p, "Ro")
	p.Update(keyMsg("tab"))
	p.Update(keyMsg("enter"))
	if p.dir != filepath.Join(home, "Music", "Rock") || p.filter != "" {
		t.Fatalf("jumped to %s", p.dir)
	}
	typeText(p, "/does/not/exist")
	p.Update(keyMsg("enter"))
	if p.err == nil || !strings.Contains(p.err.Error(), "no such folder") {
		t.Fatalf("%v", p.err)
	}
}

func TestRecentFoldersComeFirstInTheShortcuts(t *testing.T) {
	env, home := pickerEnv(t, "Downloads", "Documents", "work/clips")
	recent := filepath.Join(home, "work", "clips")
	p := newFolderPicker(env, home, filepath.Join(home, "Downloads"), []string{recent})
	if p.places[0].Path != recent || !strings.HasPrefix(p.places[0].Label, "» ") {
		t.Fatalf("%+v", p.places)
	}
}

func TestTheShortcutsAreReachableFromTheKeyboard(t *testing.T) {
	env, home := pickerEnv(t, "Downloads", "Documents", "Videos", "Music")
	p := newFolderPicker(env, home, filepath.Join(home, "Downloads"), nil)
	if p.zone != zoneList {
		t.Fatal("the list has the keyboard at first")
	}
	// Up from the top of the list moves onto the shortcuts
	p.Update(keyMsg("up"))
	if p.zone != zonePlaces || p.g.focused {
		t.Fatalf("zone=%d gridFocused=%v", p.zone, p.g.focused)
	}
	first := p.placeFocus
	p.Update(keyMsg("right"))
	if p.placeFocus != first+1 {
		t.Fatalf("→ moves to the next shortcut: %d -> %d", first, p.placeFocus)
	}
	p.Update(keyMsg("left"))
	p.Update(keyMsg("left"))
	if p.placeFocus != (first-1+len(p.places))%len(p.places) {
		t.Fatalf("← moves back and wraps: %d", p.placeFocus)
	}
	// pick one and go there
	for i, pl := range p.places {
		if strings.HasSuffix(pl.Path, "Videos") {
			p.placeFocus = i
		}
	}
	p.Update(keyMsg("enter"))
	if filepath.Base(p.dir) != "Videos" || p.zone != zoneList || !p.g.focused || p.done {
		t.Fatalf("Enter goes there and hands the keyboard back to the list: dir=%s zone=%d done=%v", p.dir, p.zone, p.done)
	}
}

func TestLeavingTheShortcutsWithoutChoosing(t *testing.T) {
	env, home := pickerEnv(t, "Downloads", "Videos")
	p := newFolderPicker(env, home, filepath.Join(home, "Downloads"), nil)
	p.Update(keyMsg("up"))
	p.Update(keyMsg("down"))
	if p.zone != zoneList || p.dir != home {
		t.Fatal("↓ returns to the list without going anywhere")
	}
	p.Update(keyMsg("up"))
	p.Update(keyMsg("esc"))
	if p.zone != zoneList || p.done {
		t.Fatal("Esc on the shortcuts goes back to the list; it does not close the picker")
	}
	p.Update(keyMsg("esc"))
	if !p.done || p.chosen != "" {
		t.Fatal("Esc on the list still cancels")
	}
}

func TestTypingWhileOnTheShortcutsFiltersTheList(t *testing.T) {
	env, home := pickerEnv(t, "Videos", "Music")
	p := newFolderPicker(env, home, "", nil)
	p.Update(keyMsg("up"))
	typeText(p, "vid")
	if p.zone != zoneList || p.filter != "vid" {
		t.Fatalf("typing returns to the list and filters: zone=%d filter=%q", p.zone, p.filter)
	}
	if got := strings.Join(rowLabels(p), ","); got != "SAVE,Videos" {
		t.Fatal(got)
	}
}

func TestTabMovesOntoTheShortcutsAndThroughThem(t *testing.T) {
	env, home := pickerEnv(t, "Downloads", "Documents", "Videos")
	p := newFolderPicker(env, home, filepath.Join(home, "Downloads"), nil)
	p.Update(keyMsg("tab"))
	if p.zone != zonePlaces {
		t.Fatal("Tab reaches the shortcuts")
	}
	before := p.placeFocus
	p.Update(keyMsg("tab"))
	if p.placeFocus != (before+1)%len(p.places) || p.dir != home {
		t.Fatal("Tab moves the highlight and does not jump anywhere yet")
	}
	p.Update(keyMsg("shift+tab"))
	if p.placeFocus != before {
		t.Fatal("Shift+Tab goes back")
	}
	// while typing a path, Tab still completes
	p.Update(keyMsg("esc"))
	typeText(p, "~/Vi")
	p.Update(keyMsg("tab"))
	if p.zone != zoneList || p.filter != "~/Videos/" {
		t.Fatalf("path completion is unchanged: zone=%d filter=%q", p.zone, p.filter)
	}
}

func TestTheHighlightedShortcutIsShownAndStaysInViewWhenTheyDoNotAllFit(t *testing.T) {
	env, home := pickerEnv(t, "Downloads", "Desktop", "Documents", "Videos", "Music", "Pictures")
	p := newFolderPicker(env, home, filepath.Join(home, "Downloads"), []string{})
	// a narrow card: not every shortcut fits on the one line
	out := p.View(56, 30)
	if !strings.Contains(out, "›") {
		t.Fatalf("a marker must say there are more shortcuts:\n%s", out)
	}
	p.Update(keyMsg("up")) // onto the shortcuts
	p.Update(keyMsg("end"))
	out = p.View(56, 30)
	last := p.places[len(p.places)-1].Label
	if !strings.Contains(out, last) || !strings.Contains(out, "‹") {
		t.Fatalf("the last shortcut must be scrolled into view, with a marker for the hidden ones (%q):\n%s", last, out)
	}
	for _, l := range strings.Split(out, "\n") {
		if lipglossWidth(l) > 56 {
			t.Fatalf("a line is too wide: %d", lipglossWidth(l))
		}
	}
	// every visible shortcut stays clickable at the position it was drawn
	p.Update(keyMsg("home"))
	p.View(56, 30)
	if len(p.placeSpans) == 0 || p.placeSpans[0].path != p.places[0].Path {
		t.Fatalf("spans: %+v", p.placeSpans)
	}
}

func TestClickingAShortcutStillWorksAndHandsBackTheKeyboard(t *testing.T) {
	env, home := pickerEnv(t, "Downloads", "Videos")
	p := newFolderPicker(env, home, filepath.Join(home, "Downloads"), nil)
	p.Update(keyMsg("up"))
	p.View(110, 40)
	var vid placeSpan
	for _, sp := range p.placeSpans {
		if strings.HasSuffix(sp.path, "Videos") {
			vid = sp
		}
	}
	p.Mouse(click(p.contentLeft+vid.x0+1, p.placeY))
	if filepath.Base(p.dir) != "Videos" || p.zone != zoneList {
		t.Fatalf("dir=%s zone=%d", p.dir, p.zone)
	}
}

func TestNewFolderIsCreatedAndEntered(t *testing.T) {
	env, home := pickerEnv(t, "Downloads")
	p := newFolderPicker(env, filepath.Join(home, "Downloads"), "", nil)
	p.Update(keyMsg("+"))
	if !p.creating {
		t.Fatal("'+' starts creating a folder")
	}
	for _, r := range "Trip: 2026" {
		p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	p.Update(keyMsg("enter"))
	want := filepath.Join(home, "Downloads", "Trip_ 2026")
	if p.creating || p.dir != want {
		t.Fatalf("creating=%v dir=%s", p.creating, p.dir)
	}
	if st, err := os.Stat(want); err != nil || !st.IsDir() {
		t.Fatal("folder must exist")
	}
	p.Update(keyMsg("+"))
	p.Update(keyMsg("esc"))
	if p.creating {
		t.Fatal("Esc leaves the input")
	}
	// '+' typed inside a filter is just a character
	typeText(p, "a+")
	if p.creating || p.filter != "a+" {
		t.Fatalf("filter %q creating=%v", p.filter, p.creating)
	}
}

func TestHiddenFoldersAppearWhenAskedOrWhenTypingADot(t *testing.T) {
	env, home := pickerEnv(t, ".config", "Videos")
	p := newFolderPicker(env, home, "", nil)
	if strings.Contains(strings.Join(rowLabels(p), ","), ".config") {
		t.Fatal("hidden by default")
	}
	p.Update(keyMsg("ctrl+t"))
	if !strings.Contains(strings.Join(rowLabels(p), ","), ".config") {
		t.Fatal("ctrl+t shows them")
	}
	p.Update(keyMsg("ctrl+t"))
	typeText(p, ".co")
	if !strings.Contains(strings.Join(rowLabels(p), ","), ".config") {
		t.Fatalf("typing a dot reveals them: %v", rowLabels(p))
	}
}

func TestAFolderThatCannotBeWrittenIsRefusedWithAnExplanation(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("root can write anywhere")
	}
	env, home := pickerEnv(t, "ro")
	ro := filepath.Join(home, "ro")
	os.Chmod(ro, 0o500)
	defer os.Chmod(ro, 0o700)
	p := newFolderPicker(env, ro, "", nil)
	p.Update(keyMsg("enter"))
	if p.done || p.err == nil || !strings.Contains(p.err.Error(), "cannot write") {
		t.Fatalf("done=%v err=%v", p.done, p.err)
	}
}

func TestMouseCrumbsPlacesRowsAndButtons(t *testing.T) {
	env, home := pickerEnv(t, "Downloads/2026/clips", "Documents", "Videos")
	start := filepath.Join(home, "Downloads", "2026")
	p := newFolderPicker(env, start, filepath.Join(home, "Downloads"), nil)
	p.View(110, 40)

	// clicking a breadcrumb segment jumps there ("~" is the first one)
	p.Mouse(click(p.contentLeft+p.crumbs[0].x0, p.crumbY))
	if p.dir != home {
		t.Fatalf("crumb: %s", p.dir)
	}
	p.View(110, 40)

	// clicking a place chip jumps there
	var docs placeSpan
	for _, pl := range p.placeSpans {
		if strings.HasSuffix(pl.path, "Documents") {
			docs = pl
		}
	}
	if docs.path == "" {
		t.Fatalf("no Documents chip: %+v", p.placeSpans)
	}
	p.Mouse(click(p.contentLeft+docs.x0+1, p.placeY))
	if p.dir != docs.path {
		t.Fatalf("place: %s", p.dir)
	}
	p.open(home)
	p.View(110, 40)

	// a click highlights a row, a second click on it opens it
	labels := rowLabels(p)
	idx := -1
	for i, l := range labels {
		if l == "Videos" {
			idx = i
		}
	}
	y := p.gridY + idx // the list has no header row
	p.Mouse(click(p.gridX+4, y))
	if p.current().entry.Name != "Videos" || p.dir != home {
		t.Fatalf("first click only highlights: %+v dir=%s", p.current(), p.dir)
	}
	p.Mouse(click(p.gridX+4, y))
	if filepath.Base(p.dir) != "Videos" {
		t.Fatalf("second click opens: %s", p.dir)
	}
	p.View(110, 40)

	// the 'Save here' button (first one) saves the current folder
	p.Mouse(click(p.actsX+1, p.actsY))
	if !p.done || filepath.Base(p.chosen) != "Videos" {
		t.Fatalf("button: done=%v chosen=%s", p.done, p.chosen)
	}
}

func TestPickerViewStaysInsideTheTerminalAndShowsTheKeyHints(t *testing.T) {
	env, home := pickerEnv(t, "a", "b", "c")
	p := newFolderPicker(env, home, "", nil)
	for _, size := range [][2]int{{60, 20}, {80, 24}, {120, 50}, {200, 60}} {
		out := p.View(size[0], size[1])
		lines := strings.Split(out, "\n")
		if len(lines) > size[1] {
			t.Fatalf("%v: %d lines", size, len(lines))
		}
		for _, l := range lines {
			if w := lipglossWidth(l); w > size[0] {
				t.Fatalf("%v: line %d wide: %q", size, w, l)
			}
		}
	}
	out := p.View(100, 30)
	for _, want := range []string{"Choose a folder", "Save in this folder", "type to filter", "New folder"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
}
