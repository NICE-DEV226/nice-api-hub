package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/history"
)

func TestDownloadsAreRememberedAndCanBeRepeated(t *testing.T) {
	g := newGW(t)
	dir := t.TempDir()
	hist := filepath.Join(t.TempDir(), "history.jsonl")
	keep := func(e *Env) { e.HistoryPath = hist }

	if r := run(t, g, keep, "history"); r.code != 0 || !strings.Contains(r.out, "Nothing downloaded yet") {
		t.Fatalf("%+v", r)
	}
	if r := run(t, g, keep, "download", "-q", "--max-height", "720", "-o", dir+string(os.PathSeparator), "https://y/watch?v=1"); r.code != 0 {
		t.Fatalf("%+v", r)
	}
	r := run(t, g, keep, "history", "--json")
	var entries []history.Entry
	if err := json.Unmarshal([]byte(r.out), &entries); err != nil || len(entries) != 1 {
		t.Fatalf("%v %s", err, r.out)
	}
	e := entries[0]
	if e.URL != "https://y/watch?v=1" || e.Kind != "video" || e.MaxHeight != 720 || e.Path != filepath.Join(dir, "clip.mp4") || e.Bytes != 5 || e.Title != "clip" {
		t.Fatalf("%+v", e)
	}
	if r := run(t, g, keep, "history"); !strings.Contains(r.out, "720p") || !strings.Contains(r.out, "nah again") {
		t.Fatalf("%s", r.out)
	}

	// again: same request, same folder, and the first file is NOT overwritten
	if r := run(t, g, keep, "again", "-q"); r.code != 0 || strings.TrimSpace(r.out) != filepath.Join(dir, "clip (2).mp4") {
		t.Fatalf("%+v", r)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "clip.mp4")); string(b) != "bytes" {
		t.Fatal("the original must be untouched")
	}
	if r := run(t, g, keep, "again", "2", "-o", filepath.Join(dir, "elsewhere")+string(os.PathSeparator), "-q"); r.code != 0 || !strings.HasSuffix(strings.TrimSpace(r.out), filepath.Join("elsewhere", "clip.mp4")) {
		t.Fatalf("by number, to another folder: %+v", r)
	}
	if r := run(t, g, keep, "again", "99"); r.code != ExitUsage || !strings.Contains(r.err, "no history entry") {
		t.Fatalf("%+v", r)
	}

	// clear needs confirmation without a terminal
	if r := run(t, g, keep, "history", "--clear"); r.code != ExitUsage {
		t.Fatalf("%+v", r)
	}
	if r := run(t, g, keep, "history", "--clear", "--yes"); r.code != 0 {
		t.Fatalf("%+v", r)
	}
	if r := run(t, g, keep, "again"); r.code != ExitUsage || !strings.Contains(r.err, "nothing in the history") {
		t.Fatalf("%+v", r)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "clip.mp4")); string(b) != "bytes" {
		t.Fatal("clearing the history must not delete files")
	}
}

func TestFailedDownloadsAreNotRemembered(t *testing.T) {
	g := newGW(t)
	hist := filepath.Join(t.TempDir(), "h.jsonl")
	keep := func(e *Env) { e.HistoryPath = hist }
	dir := t.TempDir()
	run(t, g, keep, "download", "-q", "-o", dir+string(os.PathSeparator), "u") // ok
	run(t, g, keep, "download", "-q", "-o", dir+string(os.PathSeparator), "u") // refused: exists
	r := run(t, g, keep, "history", "--json")
	var entries []history.Entry
	json.Unmarshal([]byte(r.out), &entries)
	if len(entries) != 1 {
		t.Fatalf("%d entries", len(entries))
	}
}
