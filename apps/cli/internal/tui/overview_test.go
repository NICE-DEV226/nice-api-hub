package tui

import (
	"context"
	"errors"
	"image"
	"image/color"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
)

func gradientImage(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x * 255 / w), uint8(y * 255 / h), 120, 255})
		}
	}
	return img
}

// overviewApp is the download screen showing a resolved video with a thumbnail.
func overviewApp(t *testing.T, w, h int, thumb func(context.Context, string) (image.Image, error), open func(string) error) (*App, *playground) {
	t.Helper()
	prev := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor) // tests run without a terminal: ask for colour so the image is drawn as blocks
	t.Cleanup(func() { lipgloss.SetColorProfile(prev) })
	g := newFakeGateway(t)
	c, _ := api.New(g.URL, "nah_live_test", "")
	d := Deps{Client: c, Profile: "test", HasAPI: true, Thumb: thumb, OpenURL: open, Copy: func(string) tea.Cmd { return nil }}
	a := NewApp(d)
	a.Update(tea.WindowSizeMsg{Width: w, Height: h})
	pg := a.current().(*playground)
	yes := true
	title, author, thumbURL, dur := "These Kyrie Highlights Will Get You HYPED for the Mavericks Season", "NBA", "https://i.example/kyrie.jpg", 644.0
	pg.res = &api.MediaResult{Meta: api.MediaMeta{TookMs: 900}, Data: api.Media{
		Platform: "youtube", Provider: "ytdlp", SourceURL: "https://youtu.be/kyrie", Title: &title, Author: &author, Thumbnail: &thumbURL, DurationSeconds: &dur,
		Variants: []api.Variant{
			{Kind: "video", Height: 1080, Ext: "mp4", HasAudio: &yes, SizeBytes: 250_000_000, URL: "https://cdn/1080"},
			{Kind: "video", Height: 720, Ext: "mp4", HasAudio: &yes, URL: "https://cdn/720"},
			{Kind: "audio", Ext: "m4a", URL: "https://cdn/a"}}}}
	pg.state = pgResult
	pg.buildRows()
	return a, pg
}

func okThumb(context.Context, string) (image.Image, error) { return gradientImage(640, 360), nil }

// settle runs the thumbnail command and feeds its answer back, as the program would.
func settle(a *App, pg *playground) {
	if cmd := pg.fetchThumb(); cmd != nil {
		a.Update(cmd())
	}
}

func TestTheOverviewShowsThePreviewTheTitleAndPlainChoices(t *testing.T) {
	a, pg := overviewApp(t, 120, 40, okThumb, nil)
	if pg.thumbState != thumbNone {
		t.Fatal("nothing before the fetch")
	}
	cmd := pg.fetchThumb()
	if cmd == nil || pg.thumbState != thumbLoading {
		t.Fatal("a thumbnail link starts a fetch")
	}
	if !strings.Contains(a.View(), "loading preview") {
		t.Fatal("a placeholder is shown while it loads")
	}
	a.Update(cmd())
	if pg.thumbState != thumbReady {
		t.Fatalf("state %d", pg.thumbState)
	}
	out := a.View()
	for _, want := range []string{"These Kyrie Highlights", "NBA", "10:44", "youtube", "Best quality", "1080p", "720p", "Audio only", "MP3", "Open page", "Save to"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
	if n := imageRows(out); n < 8 {
		t.Fatalf("the image is drawn with half blocks: %d rows", n)
	}
	for _, l := range strings.Split(out, "\n") {
		if w := lipgloss.Width(l); w > 120 {
			t.Fatalf("a line is %d wide: %q", w, l)
		}
	}
}

func TestWideTerminalsPutTheImageBesideTheDetails(t *testing.T) {
	a, pg := overviewApp(t, 130, 40, okThumb, nil)
	settle(a, pg)
	a.View()
	if pg.gridX < 40 {
		t.Fatalf("the list must start to the right of the image: x=%d", pg.gridX)
	}
	// the title and the image share rows
	lines := strings.Split(pg.View(), "\n")
	shared := false
	for _, l := range lines {
		if strings.Contains(l, "▀") && strings.Contains(l, "These Kyrie") {
			shared = true
		}
	}
	if !shared {
		t.Fatal("image and title should be on the same rows")
	}
}

func TestNarrowTerminalsStackTheImageAboveTheDetails(t *testing.T) {
	a, pg := overviewApp(t, 80, 44, okThumb, nil)
	settle(a, pg)
	a.View()
	if pg.gridX != 1 {
		t.Fatalf("stacked layout: the list starts at the left, x=%d", pg.gridX)
	}
	out := pg.View()
	imgRow, titleRow := -1, -1
	for i, l := range strings.Split(out, "\n") {
		if strings.Contains(l, "▀") && imgRow < 0 {
			imgRow = i
		}
		if strings.Contains(l, "These Kyrie") && titleRow < 0 {
			titleRow = i
		}
	}
	if imgRow < 0 || titleRow < imgRow {
		t.Fatalf("the image comes first: image row %d, title row %d", imgRow, titleRow)
	}
}

func TestAFailedThumbnailJustMeansNoImage(t *testing.T) {
	a, pg := overviewApp(t, 120, 40, func(context.Context, string) (image.Image, error) { return nil, errors.New("HTTP 403") }, nil)
	settle(a, pg)
	out := a.View()
	if pg.thumbState != thumbNone || imageRows(out) != 0 || strings.Contains(out, "loading preview") {
		t.Fatalf("no image and no leftover placeholder (state %d)", pg.thumbState)
	}
	if !strings.Contains(out, "Best quality") {
		t.Fatal("the choices are still there")
	}
}

func TestAStaleThumbnailAnswerIsIgnored(t *testing.T) {
	a, pg := overviewApp(t, 120, 40, okThumb, nil)
	pg.fetchThumb()
	a.Update(thumbMsg{url: "https://i.example/some-other-video.jpg", img: gradientImage(10, 10)})
	if pg.thumbState != thumbLoading {
		t.Fatal("an answer for another link must not replace the current preview")
	}
}

func TestMediaWithoutAThumbnailNeverStartsAFetch(t *testing.T) {
	calls := 0
	_, pg := overviewApp(t, 120, 40, func(context.Context, string) (image.Image, error) { calls++; return nil, nil }, nil)
	pg.res.Data.Thumbnail = nil
	if pg.fetchThumb() != nil || calls != 0 || pg.thumbState != thumbNone {
		t.Fatal("no thumbnail, no request")
	}
}

func TestOOpensTheOriginalPageAndCopyUsesTheHighlightedRendition(t *testing.T) {
	var opened string
	a, pg := overviewApp(t, 120, 40, okThumb, func(u string) error { opened = u; return nil })
	pg.Update(keyMsg("o"))
	if opened != "https://youtu.be/kyrie" {
		t.Fatalf("opened %q", opened)
	}
	pg.Update(keyMsg("down")) // 1080p
	if o := pg.selectedOption(); o == nil || o.Label != "1080p" || o.LinkURL != "https://cdn/1080" {
		t.Fatalf("%+v", o)
	}
	_ = a
	pg.Update(keyMsg("o"))
	pg2 := pg
	pg2.d.OpenURL = func(string) error { return errors.New("no browser") }
	pg2.Update(keyMsg("o"))
	if !strings.Contains(pg2.toast.text, "no browser") || !pg2.toast.bad {
		t.Fatalf("a failure is shown: %+v", pg2.toast)
	}
}

func TestMPicksTheMP3RowAndAsksToDownloadIt(t *testing.T) {
	_, pg := overviewApp(t, 120, 40, okThumb, nil)
	pg.Update(keyMsg("m"))
	if o := pg.selectedOption(); o == nil || !o.MP3 {
		t.Fatalf("the MP3 row is highlighted: %+v", o)
	}
	if pg.state != pgDownloading {
		t.Fatalf("state %d", pg.state)
	}
	pg.Close()
}

func TestClickingAChoiceInTheSideBySideLayout(t *testing.T) {
	a, pg := overviewApp(t, 130, 40, okThumb, nil)
	settle(a, pg)
	a.View()
	y := a.bodyTop + pg.gridY + gridHeaderLines + 2 // third choice: 720p
	a.Update(click(a.bodyLeft()+pg.gridX+4, y))
	if o := pg.selectedOption(); o == nil || o.Label != "720p" {
		t.Fatalf("%+v (gridX=%d gridY=%d)", o, pg.gridX, pg.gridY)
	}
	// clicking the image does nothing
	a.Update(click(a.bodyLeft()+5, y))
	if o := pg.selectedOption(); o.Label != "720p" {
		t.Fatal("the image is not clickable")
	}
}

func TestButtonsShrinkToFitNarrowTerminals(t *testing.T) {
	_, pg := overviewApp(t, 60, 30, okThumb, nil)
	pg.acts.Render(pg.buttonsFor(56))
	if w := lipgloss.Width(pg.acts.Render(pg.buttonsFor(56))); w > 56 {
		t.Fatalf("buttons are %d wide", w)
	}
	keys := map[string]bool{}
	for _, a := range pg.buttonsFor(56) {
		keys[a.key] = true
	}
	if !keys["d"] || !keys["esc"] {
		t.Fatalf("download and new URL always stay: %v", keys)
	}
	if n := len(pg.buttonsFor(100)); n != 6 {
		t.Fatalf("with room every button shows, got %d", n)
	}
}

// imageRows counts the lines that carry the thumbnail: half blocks with both a foreground and a background colour.
func imageRows(view string) int {
	n := 0
	for _, l := range strings.Split(view, "\n") {
		if strings.Contains(l, "▀") && strings.Contains(l, "48;2;") && strings.Contains(l, "38;2;") {
			n++
		}
	}
	return n
}
