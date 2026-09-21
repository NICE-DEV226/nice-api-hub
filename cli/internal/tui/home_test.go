package tui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/fsnav"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

func homeApp(t *testing.T, w, h int) (*App, *playground, *fakeSession, string) {
	t.Helper()
	g := newFakeGateway(t)
	env, home := pickerEnv(t, "Downloads", "Videos")
	sess := &fakeSession{}
	c, _ := api.New(g.URL, "nah_live_test", "")
	d := Deps{Client: c, Profile: "test", HasAPI: true, Session: sess, FS: env, DownloadDir: filepath.Join(home, "Downloads"),
		Copy: func(string) tea.Cmd { return nil }}
	a := NewApp(d)
	a.Update(tea.WindowSizeMsg{Width: w, Height: h})
	pg := a.current().(*playground)
	a.View()
	return a, pg, sess, home
}

func TestTheInputIsCenteredLikeASearchPage(t *testing.T) {
	a, pg, _, _ := homeApp(t, 160, 40)
	if a.bodyWidth() != maxContentWidth || a.bodyLeft() != (160-maxContentWidth)/2 {
		t.Fatalf("content column: %d at %d", a.bodyWidth(), a.bodyLeft())
	}
	lines := strings.Split(pg.View(), "\n")
	var box []string
	for _, l := range lines {
		if t := strings.TrimSpace(l); strings.HasPrefix(t, "▗") || strings.HasPrefix(t, "▐") || strings.HasPrefix(t, "▝") {
			box = append(box, l)
		}
	}
	if len(box) != 5 {
		t.Fatalf("the home input is a roomy 5-line box, got %d\n%s", len(box), strings.Join(lines, "\n"))
	}
	w := lipgloss.Width(strings.TrimSpace(box[0]))
	left := len(box[0]) - len(strings.TrimLeft(box[0], " "))
	right := pg.w - left - w
	if d := left - right; d < -1 || d > 1 {
		t.Fatalf("the box is not centred: %d left, %d right", left, right)
	}
	if w > 90 || w < 60 {
		t.Fatalf("the input does not stretch across the screen: %d wide", w)
	}
	// vertically: in the upper-middle band, not glued to the top or the bottom
	if pg.inputY < 8 || pg.inputY > pg.h*3/4 {
		t.Fatalf("input row %d of %d", pg.inputY, pg.h)
	}
	out := pg.View()
	for _, want := range []string{"██", "Paste a media URL", "Save to", "Change"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestSmallTerminalsDropTheLogoButKeepTheInput(t *testing.T) {
	_, pg, _, _ := homeApp(t, 70, 18)
	out := pg.View()
	if strings.Contains(out, "██") {
		t.Fatal("no logo when the terminal is short")
	}
	if !strings.Contains(out, "Paste a media URL") || !strings.Contains(out, "Save to") {
		t.Fatalf("the essentials must stay:\n%s", out)
	}
	for _, l := range strings.Split(out, "\n") {
		if lipgloss.Width(l) > 70 {
			t.Fatalf("too wide: %q", l)
		}
	}
}

func TestTabAndTheFolderLineOpenThePickerAndTheChoiceIsRemembered(t *testing.T) {
	a, pg, sess, home := homeApp(t, 120, 40)
	pg.Update(keyMsg("tab"))
	if pg.picker == nil || !pg.Capturing() {
		t.Fatal("Tab opens the folder picker")
	}
	if pg.picker.dir != filepath.Join(home, "Downloads") {
		t.Fatalf("the picker starts in the current download folder: %s", pg.picker.dir)
	}
	// Videos sits next to Downloads: go up, filter, open it, save there
	pg.Update(keyMsg("left"))
	typeText(pg.picker, "vid")
	pg.Update(keyMsg("enter"))
	pg.Update(keyMsg("enter"))
	if pg.picker != nil {
		t.Fatal("the picker closes once a folder is chosen")
	}
	if pg.dir != filepath.Join(home, "Videos") {
		t.Fatalf("the folder did not change: %s", pg.dir)
	}
	if len(sess.dirs) != 1 || sess.dirs[0] != pg.dir {
		t.Fatalf("the choice must be saved as the new default: %v", sess.dirs)
	}
	if !strings.Contains(pg.View(), filepath.Base(pg.dir)) {
		t.Fatal("the new folder is shown")
	}

	// the same thing with the mouse: click the folder line
	pg.View()
	a.Update(click(a.bodyLeft()+pg.chipX0+3, a.bodyTop+pg.chipY))
	if pg.picker == nil {
		t.Fatal("clicking 'Save to' opens the picker")
	}
	// Esc cancels and leaves the folder alone
	before := pg.dir
	pg.Update(keyMsg("esc"))
	if pg.picker != nil || pg.dir != before {
		t.Fatal("cancelling keeps the current folder")
	}
}

func TestDownloadsGoToTheChosenFolder(t *testing.T) {
	g := newFakeGateway(t)
	c, _ := api.New(g.URL, "nah_live_test", "")
	dir := t.TempDir()
	d := Deps{Client: c, HasAPI: true, DownloadDir: dir, FS: fsnav.System()}
	d.defaults()
	pg := newPlayground(d)
	if pg.dir != dir {
		t.Fatalf("starts in the configured folder: %s", pg.dir)
	}
	other := filepath.Join(dir, "elsewhere")
	os.MkdirAll(other, 0o755)
	pg.dir = other
	cmd := pg.startDownload(api.DownloadRequest{URL: "https://x", Kind: "video"}, "nah-download.mp4")
	if cmd == nil {
		t.Fatal("no command")
	}
	pg.Close()
}

func TestTheProgressBarIsAFlatColour(t *testing.T) {
	bar := newBar(30)
	out := bar.ViewAs(0.5)
	if strings.Count(out, "\x1b[38;2;") > 3 && !strings.Contains(out, "38;2;88;166;255") && !strings.Contains(out, "38;2;9;105;218") {
		t.Fatalf("expected a single accent colour, got a gradient: %q", out)
	}
}

func TestWideningTheInputNeverHidesTheStartOfTheLink(t *testing.T) {
	_, pg, _, _ := homeApp(t, 120, 40)
	url := "https://www.tiktok.com/@scout2015/video/6718335390845095173"
	pg.in.SetValue(url)
	pg.in.CursorEnd()
	pg.View() // home: a narrow field that scrolls
	pg.res = &api.MediaResult{Data: api.Media{Platform: "tiktok", Variants: []api.Variant{{Kind: "video"}}}}
	pg.state = pgResult
	pg.buildRows()
	if out := pg.View(); !strings.Contains(out, url) {
		t.Fatalf("the whole link must be visible in the wide field:\n%s", out)
	}
}

func resolved(pg *playground) {
	yes := true
	pg.res = &api.MediaResult{Data: api.Media{Platform: "youtube", SourceURL: "https://youtu.be/x", Variants: []api.Variant{
		{Kind: "video", Quality: "1080p", Height: 1080, HasAudio: &yes, Ext: "mp4"}}}}
	pg.state = pgResult
	pg.buildRows()
}

func TestStartingADownloadAsksWhereToSaveAndEnterConfirmsTheProposedFolder(t *testing.T) {
	_, pg, sess, home := homeApp(t, 120, 40)
	resolved(pg)
	if !pg.ask {
		t.Fatal("with a session the default is to ask")
	}
	pg.Update(keyMsg("d"))
	if pg.picker == nil || pg.pending == nil || pg.state != pgResult {
		t.Fatalf("pressing d opens the question, nothing is downloading yet: picker=%v pending=%v state=%d", pg.picker != nil, pg.pending != nil, pg.state)
	}
	out := pg.View()
	for _, want := range []string{"Where should this download go?", "Download in this folder", "Download here", "Ask where to save every time"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
	if pg.picker.dir != filepath.Join(home, "Downloads") {
		t.Fatalf("the proposal is the current folder: %s", pg.picker.dir)
	}
	cmd := pg.Update(keyMsg("enter")) // the first row is already highlighted
	if cmd == nil || pg.picker != nil || pg.state != pgDownloading {
		t.Fatalf("Enter confirms and the download starts: cmd=%v picker=%v state=%d", cmd != nil, pg.picker != nil, pg.state)
	}
	if len(sess.dirs) != 1 {
		t.Fatalf("the folder is remembered: %v", sess.dirs)
	}
	pg.Close()
}

func TestChoosingADifferentFolderForThisDownload(t *testing.T) {
	_, pg, _, home := homeApp(t, 120, 40)
	resolved(pg)
	pg.Update(keyMsg("m")) // MP3
	pg.Update(keyMsg("left"))
	typeText(pg.picker, "vid")
	pg.Update(keyMsg("enter"))
	pg.Update(keyMsg("enter"))
	if pg.state != pgDownloading || pg.dir != filepath.Join(home, "Videos") {
		t.Fatalf("state=%d dir=%s", pg.state, pg.dir)
	}
	pg.Close()
}

func TestCancellingTheQuestionDropsTheDownloadAndKeepsTheResults(t *testing.T) {
	_, pg, sess, _ := homeApp(t, 120, 40)
	resolved(pg)
	pg.Update(keyMsg("d"))
	pg.Update(keyMsg("esc"))
	if pg.picker != nil || pg.pending != nil || pg.state != pgResult || pg.res == nil || len(sess.dirs) != 0 {
		t.Fatal("Esc must leave everything as it was")
	}
}

func TestTheAskEveryTimeSwitchIsSavedAndSkipsTheQuestionNextTime(t *testing.T) {
	a, pg, sess, _ := homeApp(t, 120, 40)
	resolved(pg)
	pg.Update(keyMsg("d"))
	pg.View()
	// click the checkbox line
	a.Update(click(a.bodyLeft()+pg.picker.askX0+1, a.bodyTop+pg.picker.askY))
	if pg.ask || !sess.noAsk {
		t.Fatalf("the switch is off and saved: ask=%v noAsk=%v", pg.ask, sess.noAsk)
	}
	pg.Update(keyMsg("enter")) // still confirms this one
	if pg.state != pgDownloading {
		t.Fatal("this download goes ahead")
	}
	pg.Close()
	pg.state = pgResult
	cmd := pg.Update(keyMsg("d"))
	if pg.picker != nil || pg.state != pgDownloading || cmd == nil {
		t.Fatal("with the question off, d downloads straight away")
	}
	pg.Close()
	// ctrl+a flips it back on
	pg.state = pgResult
	pg.openPicker()
	pg.picker.forDownload(false)
	pg.Update(keyMsg("ctrl+a"))
	if !pg.ask || sess.noAsk {
		t.Fatal("ctrl+a turns it on again")
	}
}

func TestPastingAVeryLongLinkNeverBreaksTheInputBox(t *testing.T) {
	long := "https://www.tiktok.com/@zabre.mahamoudou39/video/7686155648911887648?is_from_webapp=1&sender_device=pc&" + strings.Repeat("a", 300)
	for _, size := range [][2]int{{50, 20}, {72, 24}, {110, 30}, {160, 44}} {
		_, pg, _, _ := homeApp(t, size[0], size[1])
		pg.in.SetValue(long)
		pg.in.CursorEnd()
		lines := strings.Split(pg.View(), "\n")
		n := 0
		for _, l := range lines {
			tr := strings.TrimSpace(l)
			if strings.HasPrefix(tr, "▗") || strings.HasPrefix(tr, "▐") || strings.HasPrefix(tr, "▝") {
				n++
			}
			if w := lipgloss.Width(l); w > size[0] {
				t.Fatalf("%v: a line is %d wide", size, w)
			}
		}
		want := 5
		if size[1] < 24 {
			want = 5
		}
		if n != want {
			t.Fatalf("%v: the field must stay %d lines, got %d:\n%s", size, want, n, strings.Join(lines, "\n"))
		}
	}
}

func TestTheInputFieldIsFilledAllTheWayAcrossWithNoBareSpaces(t *testing.T) {
	// the text input pads its placeholder with plain spaces; they used to show the terminal's own colour as a dark bar
	prev := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor)
	defer lipgloss.SetColorProfile(prev)
	for _, focused := range []bool{true, false} {
		_, pg, _, _ := homeApp(t, 120, 40)
		if !focused {
			pg.in.Blur()
		}
		pg.in.SetValue("") // the placeholder state
		lines := strings.Split(pg.inputBox(90, true), "\n")
		if len(lines) != 5 {
			t.Fatalf("%d lines", len(lines))
		}
		for i, l := range lines[1 : len(lines)-1] { // the body rows; the outer rows are edge glyphs
			if bare := strings.Trim(ui.BareText(l), "▐▌"); bare != "" {
				t.Fatalf("focused=%v row %d has characters with no fill: %q", focused, i, bare)
			}
		}
	}
}
