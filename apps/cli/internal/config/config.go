// Package config loads and saves the CLI's profiles and resolves the effective settings.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// DefaultURL is used when nothing else is configured (the local docker compose stack).
const DefaultURL = "http://localhost:3000"

// Profile holds the credentials for one gateway.
type Profile struct {
	URL        string `json:"url,omitempty"`
	APIKey     string `json:"apiKey,omitempty"`
	AdminToken string `json:"adminToken,omitempty"`
}

// File is the on-disk configuration.
type File struct {
	Current  string             `json:"current,omitempty"`
	Profiles map[string]Profile `json:"profiles,omitempty"`
}

// Path returns the configuration file location ($NAH_CONFIG, else the user config dir).
func Path() (string, error) {
	if p := os.Getenv("NAH_CONFIG"); p != "" {
		return p, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("cannot locate the user config directory: %w", err)
	}
	return filepath.Join(dir, "nah", "config.json"), nil
}

// Load reads the file; a missing file yields an empty configuration.
func Load(path string) (*File, error) {
	f := &File{Profiles: map[string]Profile{}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return f, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, f); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON: %w", path, err)
	}
	if f.Profiles == nil {
		f.Profiles = map[string]Profile{}
	}
	return f, nil
}

// Save writes the file atomically with owner-only permissions (it contains secrets).
func (f *File) Save(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// Names returns the profile names, sorted.
func (f *File) Names() []string {
	names := make([]string, 0, len(f.Profiles))
	for n := range f.Profiles {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// Resolved is the effective configuration after applying every source.
type Resolved struct {
	Profile    string
	URL        string
	APIKey     string
	AdminToken string
}

// Resolve applies precedence: explicit override > environment > profile file > defaults.
func Resolve(f *File, profileFlag, urlFlag string, getenv func(string) string) Resolved {
	name := firstNonEmpty(profileFlag, getenv("NAH_PROFILE"), f.Current, "default")
	p := f.Profiles[name]
	return Resolved{
		Profile:    name,
		URL:        strings.TrimRight(firstNonEmpty(urlFlag, getenv("NAH_URL"), p.URL, DefaultURL), "/"),
		APIKey:     firstNonEmpty(getenv("NAH_API_KEY"), p.APIKey),
		AdminToken: firstNonEmpty(getenv("NAH_ADMIN_TOKEN"), p.AdminToken),
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// Mask hides a secret, keeping just enough to recognise it.
func Mask(s string) string {
	switch {
	case s == "":
		return "(not set)"
	case len(s) <= 12:
		return strings.Repeat("•", len(s))
	}
	return s[:9] + strings.Repeat("•", 8) + s[len(s)-2:]
}
