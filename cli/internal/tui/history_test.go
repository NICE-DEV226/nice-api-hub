package tui

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/history"
)

func TestHistoryViewDirect(t *testing.T) {
	tmpDir := t.TempDir()
	st := &history.Store{Path: filepath.Join(tmpDir, "history.jsonl")}

	_, err := st.Add(history.Entry{
		URL:       "https://youtube.com/watch?v=sample",
		Title:     "Sample Video",
		Platform:  "youtube",
		Kind:      "video",
		MaxHeight: 1080,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.Add(history.Entry{
		URL:         "https://soundcloud.com/song",
		Title:       "Second Song",
		Platform:    "soundcloud",
		Kind:        "audio",
		AudioFormat: "mp3",
	})
	if err != nil {
		t.Fatal(err)
	}

	d := Deps{
		History: st,
		Now:     time.Now,
	}
	hv := newHistoryView(d)
	hv.SetSize(120, 30)

	// Init loads entries
	cmd := hv.Init()
	msg := cmd()
	hv.Update(msg)

	if len(hv.entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(hv.entries))
	}
	if len(hv.filtered) != 2 {
		t.Fatalf("expected 2 filtered, got %d", len(hv.filtered))
	}

	viewStr := hv.View()
	if !strings.Contains(viewStr, "Downloads (2)") || !strings.Contains(viewStr, "Sample Video") {
		t.Fatalf("view should contain Downloads (2) and Sample Video, got:\n%s", viewStr)
	}

	// Filter
	hv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("/")})
	for _, r := range "Sample" {
		hv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if len(hv.filtered) != 1 {
		t.Fatalf("expected 1 filtered match for 'Sample', got %d (value: %q)", len(hv.filtered), hv.filterIn.Value())
	}
	if hv.filtered[0].Title != "Sample Video" {
		t.Fatalf("expected filtered to be Sample Video, got %q", hv.filtered[0].Title)
	}

	// Escape filter
	hv.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if hv.filtering {
		t.Fatal("expected filtering to be false after Esc")
	}

	// Delete
	hv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("x")})
	if !hv.confirm.active {
		t.Fatal("expected confirm to be active")
	}
	cmd = hv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	if cmd != nil {
		// reload after delete
		reloadMsg := cmd()
		hv.Update(reloadMsg)
	}
	if len(hv.entries) != 1 {
		t.Fatalf("expected 1 entry after delete, got %d", len(hv.entries))
	}
}
