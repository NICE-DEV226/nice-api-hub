package tui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/fsnav"
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

func TestPlacesAreCycledByTabAndRecentFoldersComeFirst(t *testing.T) {
	env, home := pickerEnv(t, "Downloads", "Documents", "work/clips")
	recent := filepath.Join(home, "work", "clips")
	p := newFolderPicker(env, home, filepath.Join(home, "Downloads"), []string{recent})
	if p.places[0].Path != recent || !strings.HasPrefix(p.places[0].Label, "» ") {
		t.Fatalf("%+v", p.places)
	}
	p.Update(keyMsg("tab"))
	if p.dir != p.places[1].Path {
		t.Fatalf("Tab jumps to the next place: %s", p.dir)
	}
	p.Update(keyMsg("shift+tab"))
	if p.dir != p.places[0].Path {
		t.Fatalf("Shift+Tab goes back: %s", p.dir)
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
	for _, want := range []string{"Choose a folder", "Save in this folder", "Type to filter", "New folder"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
}
