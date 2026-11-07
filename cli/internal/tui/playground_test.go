package tui

import (
	"testing"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
)

// The playlist worker and the view share the checkpoint's items slice: statuses
// written by the worker must be visible to "Resume remaining" in the same session.
func TestPlaylistResumeSkipsItemsDoneInTheSameSession(t *testing.T) {
	g := newFakeGateway(t)
	d := testDeps(t, g, true, false)
	d.Now = time.Now
	d.DataDir = t.TempDir()
	pg := newPlayground(d)
	title := "Mix"
	pg.playlist = &api.Playlist{
		Platform:  "youtube",
		SourceURL: "https://www.youtube.com/playlist?list=PLtest",
		Title:     &title,
		Entries: []api.PlaylistEntry{
			{ID: "e1", URL: "https://www.youtube.com/watch?v=v1"},
			{ID: "e2", URL: "https://www.youtube.com/watch?v=v2"},
		},
	}

	run := func() int {
		cmd := pg.startPlaylistDownload()
		startMsg, ok := cmd().(dlStartMsg)
		if !ok {
			t.Fatalf("expected dlStartMsg, got %T", cmd())
		}
		starts := 0
		for ev := range startMsg.ch {
			if ev.kind == "start" {
				starts++
			}
		}
		return starts
	}

	if n := run(); n != 2 {
		t.Fatalf("first run should download both entries, got %d", n)
	}
	for i, item := range pg.playlistCP.Items {
		if item.Status != "done" {
			t.Fatalf("item %d status = %q, want done: the worker's checkpoint is not shared with the view", i, item.Status)
		}
	}
	if n := run(); n != 0 {
		t.Fatalf("resume in the same session should skip completed items, got %d downloads", n)
	}
}
