package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
)

func click(x, y int) tea.MouseMsg {
	return tea.MouseMsg{X: x, Y: y, Action: tea.MouseActionPress, Button: tea.MouseButtonLeft}
}

func wheel(x, y int, up bool) tea.MouseMsg {
	b := tea.MouseButtonWheelDown
	if up {
		b = tea.MouseButtonWheelUp
	}
	return tea.MouseMsg{X: x, Y: y, Action: tea.MouseActionPress, Button: b}
}

func sized(t *testing.T, w, h int, hasAPI, hasAdmin bool) *App {
	t.Helper()
	g := newFakeGateway(t)
	a := NewApp(testDeps(t, g, hasAPI, hasAdmin))
	a.active = 0
	a.Update(tea.WindowSizeMsg{Width: w, Height: h})
	a.View() // a render records where everything is
	return a
}

func TestClickingATabSwitchesToIt(t *testing.T) {
	a := sized(t, 130, 40, true, true)
	if len(a.tabSpans) != 3 {
		t.Fatalf("spans: %v", a.tabSpans)
	}
	for want := range a.tabs {
		sp := a.tabSpans[want]
		a.Update(click(sp[0]+1, a.tabRow))
		if a.active != want {
			t.Fatalf("click on tab %d landed on %d", want, a.active)
		}
		a.View()
	}
	// the last cell of a tab still belongs to it, the next cell belongs to the next one
	sp := a.tabSpans[0]
	a.Update(click(sp[1]-1, a.tabRow))
	if a.active != 0 {
		t.Fatalf("edge of tab 0: %d", a.active)
	}
}

func TestClicksElsewhereOnTheHeaderOrBelowTheTabsDoNothing(t *testing.T) {
	a := sized(t, 130, 40, true, true)
	a.Update(click(3, 0)) // the brand
	a.Update(click(a.tabSpans[1][0], a.tabRow+5))
	if a.active != 0 {
		t.Fatalf("stray click switched the tab: %d", a.active)
	}
	// releases and drags are not clicks
	a.Update(tea.MouseMsg{X: a.tabSpans[1][0], Y: a.tabRow, Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft})
	a.Update(tea.MouseMsg{X: a.tabSpans[1][0], Y: a.tabRow, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	if a.active != 0 {
		t.Fatalf("release/drag switched the tab: %d", a.active)
	}
}

func TestTabsStayClickableWhenTheHeaderWrapsOnNarrowTerminals(t *testing.T) {
	a := sized(t, 66, 30, true, true)
	if a.tabRow != 1 || a.bodyTop != 3 {
		t.Fatalf("narrow terminals put the tabs on a second line: row=%d top=%d", a.tabRow, a.bodyTop)
	}
	a.Update(click(a.tabSpans[2][0]+1, a.tabRow))
	if a.active != 2 {
		t.Fatalf("active %d", a.active)
	}
}

func resultPlayground(t *testing.T) (*App, *playground) {
	t.Helper()
	a := sized(t, 110, 36, true, false)
	a.switchTo(len(a.tabs) - 1)
	pg := a.current().(*playground)
	yes := true
	pg.res = &api.MediaResult{Data: api.Media{Platform: "youtube", Provider: "ytdlp", SourceURL: "https://youtu.be/x", Variants: []api.Variant{
		{Kind: "video", Quality: "1080p", Height: 1080, HasAudio: &yes, Ext: "mp4"},
		{Kind: "video", Quality: "720p", Height: 720, HasAudio: &yes, Ext: "mp4"},
		{Kind: "audio", Quality: "128k", Ext: "m4a"},
	}}}
	pg.state = pgResult
	pg.buildRows()
	a.View()
	return a, pg
}

func TestClickingAResultRowSelectsItAndASecondClickDownloadsIt(t *testing.T) {
	a, pg := resultPlayground(t)
	rowY := a.bodyTop + pg.gridY + gridHeaderLines
	a.Update(click(a.bodyLeft()+5, rowY+2)) // third row
	if pg.tbl.Cursor() != 2 {
		t.Fatalf("cursor %d", pg.tbl.Cursor())
	}
	if pg.state != pgResult {
		t.Fatal("first click only selects")
	}
	_, cmd := a.Update(click(a.bodyLeft()+5, rowY+2))
	if pg.state != pgDownloading || cmd == nil {
		t.Fatalf("second click must start the download (state %d)", pg.state)
	}
	pg.Close()
}

func TestClickingAButtonRunsItsAction(t *testing.T) {
	a, pg := resultPlayground(t)
	a.View()
	// the "New URL" button is the last one
	last := pg.acts.spans[len(pg.acts.spans)-1]
	a.Update(click(a.bodyLeft()+1+last[0]+1, a.bodyTop+pg.actsY))
	if pg.state != pgInput {
		t.Fatalf("the New URL button must return to the input, state %d", pg.state)
	}
}

func TestMouseWheelMovesTheSelection(t *testing.T) {
	a, pg := resultPlayground(t)
	a.Update(wheel(a.bodyLeft()+10, a.bodyTop+pg.gridY+3, false))
	a.Update(wheel(a.bodyLeft()+10, a.bodyTop+pg.gridY+3, false))
	if pg.tbl.Cursor() != 2 {
		t.Fatalf("cursor %d", pg.tbl.Cursor())
	}
	a.Update(wheel(a.bodyLeft()+10, a.bodyTop+pg.gridY+3, true))
	if pg.tbl.Cursor() != 1 {
		t.Fatalf("cursor %d", pg.tbl.Cursor())
	}
}

func TestClickingAnAccountSelectsItAndFetchesItsKeys(t *testing.T) {
	g := newFakeGateway(t)
	a := NewApp(testDeps(t, g, false, true))
	a.Update(tea.WindowSizeMsg{Width: 130, Height: 40})
	a.switchTo(1)
	acc := a.current().(*accountsView)
	acc.loaded = true
	acc.accs = []api.Account{{ID: acct1, Name: "Acme Corp", PlanID: "pro", Status: "active"}, {ID: acct2, Name: "Other", PlanID: "free", Status: "active"}}
	acc.rebuildAccountRows(acct1)
	a.View()
	_, cmd := a.Update(click(a.bodyLeft()+6, a.bodyTop+2+gridHeaderLines+1)) // second account
	if acc.selected() == nil || acc.selected().ID != acct2 {
		t.Fatalf("selected %+v", acc.selected())
	}
	if cmd == nil {
		t.Fatal("selecting another account must load its keys")
	}
	if acc.pane != 0 {
		t.Fatal("a click on the left panel focuses it")
	}
	a.Update(click(a.bodyLeft()+a.bodyWidth()-10, a.bodyTop+4))
	if acc.pane != 1 {
		t.Fatal("a click on the right panel focuses it")
	}
	if !strings.Contains(a.View(), "Other") {
		t.Fatal("render")
	}
}
