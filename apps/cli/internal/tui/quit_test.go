package tui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// isQuit runs a command and reports whether it ends the program.
func isQuit(cmd tea.Cmd) bool {
	if cmd == nil {
		return false
	}
	_, ok := cmd().(tea.QuitMsg)
	return ok
}

func TestTheHeaderHasAClickableQuit(t *testing.T) {
	a := sized(t, 120, 40, true, true)
	if a.quitSpan[1] <= a.quitSpan[0] {
		t.Fatalf("no quit button: %v", a.quitSpan)
	}
	if !strings.Contains(a.View(), "× Quit") {
		t.Fatal("the button must be visible")
	}
	_, cmd := a.Update(click(a.quitSpan[0]+1, a.tabRow))
	if !isQuit(cmd) {
		t.Fatal("clicking Quit ends the program")
	}
	// the blank cells in front of the button are not part of it
	a = sized(t, 120, 40, true, true)
	if _, cmd := a.Update(click(a.quitSpan[0]-1, a.tabRow)); isQuit(cmd) {
		t.Fatal("the blank cells before Quit are not part of the button")
	}
}

func TestQuitStaysClickableWhenTheHeaderWraps(t *testing.T) {
	a := sized(t, 60, 30, true, true)
	if a.tabRow != 1 {
		t.Fatalf("the header should wrap on a narrow terminal: tabRow=%d", a.tabRow)
	}
	if _, cmd := a.Update(click(a.quitSpan[0]+1, a.tabRow)); !isQuit(cmd) {
		t.Fatal("Quit works on the second header line too")
	}
}

func TestQuitIsClickableOnTheWelcomeScreenToo(t *testing.T) {
	g := newFakeGateway(t)
	a, _ := newSetupApp(t, &fakeSession{}, g)
	a.View()
	if a.quitSpan[1] <= a.quitSpan[0] {
		t.Fatalf("%v", a.quitSpan)
	}
	if _, cmd := a.Update(click(a.quitSpan[0]+1, a.tabRow)); !isQuit(cmd) {
		t.Fatal("no tabs there, but Quit is")
	}
}

func TestTheWelcomeMenuOffersQuit(t *testing.T) {
	g := newFakeGateway(t)
	_, sv := newSetupApp(t, &fakeSession{}, g)
	sv.state = stMenu
	sv.buildMenu()
	last := sv.items[len(sv.items)-1]
	if last.key != "quit" {
		t.Fatalf("Quit is the last entry, got %q", last.key)
	}
	sv.cursor = len(sv.items) - 1
	cmd := sv.onKey(keyMsg("enter"))
	if cmd == nil {
		t.Fatal("no command")
	}
	if _, ok := cmd().(quitMsg); !ok {
		t.Fatal("choosing Quit asks the app to close")
	}
	a := NewApp(sv.d)
	if _, c := a.Update(quitMsg{}); !isQuit(c) {
		t.Fatal("the app closes on quitMsg")
	}
}

func TestPressingEscTwiceOnTheEmptyHomeScreenQuits(t *testing.T) {
	_, pg, _, _ := homeApp(t, 120, 40)
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	pg.d.Now = func() time.Time { return now }

	if cmd := pg.Update(keyMsg("esc")); cmd != nil {
		t.Fatal("the first Esc does not quit")
	}
	if !strings.Contains(pg.View(), "Press Esc again to quit") {
		t.Fatal("it says how to quit")
	}
	now = now.Add(time.Second)
	cmd := pg.Update(keyMsg("esc"))
	if cmd == nil {
		t.Fatal("the second Esc within a few seconds quits")
	}
	if _, ok := cmd().(quitMsg); !ok {
		t.Fatal("it asks the app to close")
	}
}

func TestEscFirstClearsWhatWasTypedAndAStaleEscDoesNotQuit(t *testing.T) {
	_, pg, _, _ := homeApp(t, 120, 40)
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	pg.d.Now = func() time.Time { return now }

	pg.in.SetValue("https://example.com/x")
	if cmd := pg.Update(keyMsg("esc")); cmd != nil || pg.in.Value() != "" {
		t.Fatal("Esc with text in the box clears it and never quits")
	}
	if !pg.escAt.IsZero() {
		t.Fatal("clearing the box must not arm the quit")
	}
	pg.Update(keyMsg("esc")) // arms
	now = now.Add(10 * time.Second)
	if cmd := pg.Update(keyMsg("esc")); cmd != nil {
		t.Fatal("an Esc from 10 seconds ago must not count")
	}
}

func TestTheFooterAlwaysShowsHowToQuitEvenWhileTyping(t *testing.T) {
	a, pg, _, _ := homeApp(t, 120, 40)
	if !pg.Capturing() {
		t.Fatal("the home input has the keyboard")
	}
	out := a.View()
	if !strings.Contains(out, "ctrl+c") || !strings.Contains(out, "quit") {
		t.Fatalf("the footer must mention ctrl+c quit:\n%s", out)
	}
	if !strings.Contains(out, "esc esc") {
		t.Fatal("and the double Esc")
	}
}
