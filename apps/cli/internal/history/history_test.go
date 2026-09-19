package history

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

func newStore(t *testing.T) *Store {
	return &Store{Path: filepath.Join(t.TempDir(), "data", "history.jsonl")}
}

func TestAddListNewestFirstAndPrivate(t *testing.T) {
	s := newStore(t)
	base := time.Date(2026, 9, 19, 10, 0, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		if _, err := s.Add(Entry{URL: fmt.Sprintf("https://x/%d", i), Kind: "video", MaxHeight: 720, Path: "/tmp/a", At: base.Add(time.Duration(i) * time.Hour)}); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.List()
	if err != nil || len(got) != 3 || got[0].URL != "https://x/2" || got[2].URL != "https://x/0" {
		t.Fatalf("%+v %v", got, err)
	}
	if got[0].ID == "" {
		t.Fatal("ids are assigned")
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(s.Path); st.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v: the history says what you watch, keep it private", st.Mode().Perm())
		}
	}
}

func TestMissingFileIsEmptyAndCorruptLinesAreSkipped(t *testing.T) {
	s := newStore(t)
	if got, err := s.List(); err != nil || len(got) != 0 {
		t.Fatalf("%v %v", got, err)
	}
	s.Add(Entry{URL: "https://ok/1", Kind: "audio"})
	f, _ := os.OpenFile(s.Path, os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString("{torn line\n\n{\"foo\":1}\n")
	f.Close()
	s.Add(Entry{URL: "https://ok/2", Kind: "audio"})
	got, err := s.List()
	if err != nil || len(got) != 2 {
		t.Fatalf("a torn line must not hide the others: %+v %v", got, err)
	}
}

func TestTrimKeepsTheNewestAndCostsOneAppendMostOfTheTime(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "h.jsonl"), Max: 10}
	for i := 0; i < 30; i++ {
		s.Add(Entry{URL: fmt.Sprintf("https://x/%02d", i), Kind: "video", At: time.Unix(int64(1000+i), 0)})
	}
	got, _ := s.List()
	if len(got) > 12 || len(got) < 10 {
		t.Fatalf("kept %d", len(got))
	}
	if got[0].URL != "https://x/29" {
		t.Fatalf("newest must survive: %s", got[0].URL)
	}
}

func TestRemoveAndClear(t *testing.T) {
	s := newStore(t)
	a, _ := s.Add(Entry{URL: "https://a", Kind: "video"})
	s.Add(Entry{URL: "https://b", Kind: "video"})
	if err := s.Remove(a.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := s.List()
	if len(got) != 1 || got[0].URL != "https://b" {
		t.Fatalf("%+v", got)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if err := s.Clear(); err != nil {
		t.Fatal("clearing twice is fine")
	}
	if got, _ := s.List(); len(got) != 0 {
		t.Fatal("cleared")
	}
}

func TestConcurrentAddsLoseNothing(t *testing.T) {
	s := newStore(t)
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s.Add(Entry{URL: fmt.Sprintf("https://x/%d", i), Kind: "video"})
		}(i)
	}
	wg.Wait()
	if got, _ := s.List(); len(got) != 40 {
		t.Fatalf("%d", len(got))
	}
}

func TestEntryRequestAndLabel(t *testing.T) {
	cases := []struct {
		e     Entry
		label string
		kind  string
	}{
		{Entry{Kind: "video", MaxHeight: 1080}, "1080p", "video"},
		{Entry{Kind: "audio", AudioFormat: "mp3"}, "mp3", "audio"},
		{Entry{Kind: "audio"}, "audio", "audio"},
		{Entry{Kind: "video"}, "video", "video"},
	}
	for _, c := range cases {
		c.e.URL = "https://x"
		if c.e.Label() != c.label || c.e.Request().Kind != c.kind || c.e.Request().URL != "https://x" {
			t.Errorf("%+v -> %q %+v", c.e, c.e.Label(), c.e.Request())
		}
	}
	e := Entry{Path: filepath.Join(t.TempDir(), "nope.mp4")}
	if e.Exists() {
		t.Fatal("missing file")
	}
	os.WriteFile(e.Path, []byte("x"), 0o600)
	if !e.Exists() {
		t.Fatal("present file")
	}
}
