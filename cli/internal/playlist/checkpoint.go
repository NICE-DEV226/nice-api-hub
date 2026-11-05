package playlist

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Item struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	Title     string    `json:"title,omitempty"`
	Status    string    `json:"status"` // pending | downloading | done | failed
	Path      string    `json:"path,omitempty"`
	Attempts  int       `json:"attempts"`
	LastError string    `json:"lastError,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Checkpoint struct {
	Key       string    `json:"key"`
	SourceURL string    `json:"sourceUrl"`
	Title     string    `json:"title,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
	Items     []Item    `json:"items"`
}

type Store struct {
	Path string
	mu   sync.Mutex
}

func Key(sourceURL string, entries []struct{ ID, URL string }) string {
	h := sha256.New()
	h.Write([]byte(sourceURL))
	for _, entry := range entries {
		h.Write([]byte{0})
		h.Write([]byte(entry.ID))
		h.Write([]byte{0})
		h.Write([]byte(entry.URL))
	}
	return hex.EncodeToString(h.Sum(nil))[:24]
}

func (s *Store) Load(key string) (*Checkpoint, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.Path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var all map[string]Checkpoint
	if json.Unmarshal(data, &all) != nil {
		return nil, nil
	}
	checkpoint, ok := all[key]
	if !ok {
		return nil, nil
	}
	return &checkpoint, nil
}

func (s *Store) Save(checkpoint Checkpoint) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return err
	}
	var all map[string]Checkpoint
	data, err := os.ReadFile(s.Path)
	if err == nil {
		_ = json.Unmarshal(data, &all)
	}
	if all == nil {
		all = make(map[string]Checkpoint)
	}
	checkpoint.UpdatedAt = time.Now().UTC()
	all[checkpoint.Key] = checkpoint
	data, err = json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.Path), ".playlist-checkpoint-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, s.Path)
}
