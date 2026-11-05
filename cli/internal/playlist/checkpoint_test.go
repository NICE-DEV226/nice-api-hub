package playlist

import (
	"path/filepath"
	"testing"
)

func TestStoreRoundTripsAtomically(t *testing.T) {
	store := &Store{Path: filepath.Join(t.TempDir(), "state", "playlist.json")}
	checkpoint := Checkpoint{
		Key:       "abc",
		SourceURL: "https://example.test/playlist",
		Items:     []Item{{ID: "1", URL: "https://example.test/1", Status: "done", Path: "/tmp/one.mp4", Attempts: 1}},
	}
	if err := store.Save(checkpoint); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load("abc")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Items[0].Status != "done" || got.Items[0].Path != "/tmp/one.mp4" {
		t.Fatalf("checkpoint = %#v", got)
	}
}

func TestKeyIsStableAndChangesWithEntries(t *testing.T) {
	entries := []struct{ ID, URL string }{{ID: "1", URL: "https://example.test/1"}}
	key := Key("playlist", entries)
	if key != Key("playlist", entries) {
		t.Fatal("same playlist must have a stable key")
	}
	other := []struct{ ID, URL string }{{ID: "2", URL: "https://example.test/2"}}
	if Key("playlist", entries) == Key("playlist", other) {
		t.Fatal("different entries must not share a key")
	}
}
