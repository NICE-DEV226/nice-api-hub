// Package history remembers what this computer downloaded, so it can be found and downloaded again in one
// keystroke. It is a local convenience file: nothing here is sent to the gateway.
package history

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
)

// Entry is one finished download.
type Entry struct {
	ID          string    `json:"id"`
	At          time.Time `json:"at"`
	URL         string    `json:"url"`
	Title       string    `json:"title,omitempty"`
	Platform    string    `json:"platform,omitempty"`
	Kind        string    `json:"kind"` // video | audio
	MaxHeight   int       `json:"maxHeight,omitempty"`
	AudioFormat string    `json:"audioFormat,omitempty"`
	Path        string    `json:"path"`
	Bytes       int64     `json:"bytes"`
}

// Request rebuilds the download request that produced this entry.
func (e Entry) Request() api.DownloadRequest {
	return api.DownloadRequest{URL: e.URL, Kind: e.Kind, MaxHeight: e.MaxHeight, AudioFormat: e.AudioFormat}
}

// Exists reports whether the saved file is still where it was left.
func (e Entry) Exists() bool {
	st, err := os.Stat(e.Path)
	return err == nil && !st.IsDir()
}

// Label describes the quality in a few characters ("1080p", "mp3", "audio").
func (e Entry) Label() string {
	switch {
	case e.AudioFormat != "":
		return e.AudioFormat
	case e.Kind == "audio":
		return "audio"
	case e.MaxHeight > 0:
		return itoa(e.MaxHeight) + "p"
	}
	return "video"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// Store is an append-only JSON-lines file, trimmed to Max entries.
type Store struct {
	Path string
	// Max is the number of entries kept (default 500).
	Max int
	mu  sync.Mutex
}

// NewID returns a short random id.
func NewID() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) max() int {
	if s.Max > 0 {
		return s.Max
	}
	return 500
}

// Add records e. A zero ID and time are filled in.
func (s *Store) Add(e Entry) (Entry, error) {
	if e.ID == "" {
		e.ID = NewID()
	}
	if e.At.IsZero() {
		e.At = time.Now().UTC()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return e, err
	}
	line, err := json.Marshal(e)
	if err != nil {
		return e, err
	}
	f, err := os.OpenFile(s.Path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return e, err
	}
	_, werr := f.Write(append(line, '\n'))
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return e, werr
	}
	// trim lazily: only when 20% over the limit, so most calls are a single append
	if all, err := s.read(); err == nil && len(all) > s.max()+s.max()/5 {
		return e, s.rewrite(all[len(all)-s.max():])
	}
	return e, nil
}

func (s *Store) read() ([]Entry, error) {
	f, err := os.Open(s.Path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Entry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var e Entry
		if json.Unmarshal(sc.Bytes(), &e) != nil || e.ID == "" || e.URL == "" {
			continue // a torn or foreign line must not hide the rest
		}
		out = append(out, e)
	}
	return out, sc.Err()
}

func (s *Store) rewrite(entries []Entry) error {
	tmp, err := os.CreateTemp(filepath.Dir(s.Path), ".history-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	w := bufio.NewWriter(tmp)
	for _, e := range entries {
		line, _ := json.Marshal(e)
		w.Write(append(line, '\n'))
	}
	if err := w.Flush(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.Path)
}

// List returns the entries, newest first.
func (s *Store) List() ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.read()
	if err != nil {
		return nil, err
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].At.After(all[j].At) })
	return all, nil
}

// Remove forgets an entry (the file on disk is not touched).
func (s *Store) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.read()
	if err != nil {
		return err
	}
	kept := all[:0]
	for _, e := range all {
		if e.ID != id {
			kept = append(kept, e)
		}
	}
	return s.rewrite(kept)
}

// Clear forgets everything.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
