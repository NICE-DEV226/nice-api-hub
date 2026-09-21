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

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/paths"
)

// DefaultURL is used when nothing else is configured (the local docker compose stack).
const DefaultURL = "http://localhost:3000"

// Profile holds the settings and credentials for one gateway.
//
// Secrets live in the OS credential store when there is one; their kinds are then listed in Vaulted and the
// matching fields below stay empty. Without a credential store (servers, containers) they are kept here, and the
// file is private (0600).
type Profile struct {
	URL        string `json:"url,omitempty"`
	APIKey     string `json:"apiKey,omitempty"`
	AdminToken string `json:"adminToken,omitempty"`
	// Vaulted lists the secret kinds kept in the credential store instead of this file.
	Vaulted []string `json:"vaulted,omitempty"`

	// Who this computer is on that gateway (not secret).
	AccountID   string `json:"accountId,omitempty"`
	AccountName string `json:"accountName,omitempty"`
	Plan        string `json:"plan,omitempty"`
	KeyID       string `json:"keyId,omitempty"`
	Device      string `json:"device,omitempty"`

	// DownloadDir overrides the default download folder.
	DownloadDir string `json:"downloadDir,omitempty"`
	// SaveWithoutAsking skips the "where to save?" question and downloads straight into DownloadDir.
	// The default (false) asks every time, when a download starts.
	SaveWithoutAsking bool `json:"saveWithoutAsking,omitempty"`
	// RecentDirs are the folders chosen for downloads before, most recent first.
	RecentDirs []string `json:"recentDirs,omitempty"`
}

// MaxRecentDirs is how many recent folders are remembered.
const MaxRecentDirs = 8

// RememberDir makes dir the default download folder and moves it to the front of the recent folders.
func (p *Profile) RememberDir(dir string) {
	p.DownloadDir = dir
	out := []string{dir}
	for _, d := range p.RecentDirs {
		if d != dir && len(out) < MaxRecentDirs {
			out = append(out, d)
		}
	}
	p.RecentDirs = out
}

// Secret kinds.
const (
	KindAPIKey = "api-key"
	KindAdmin  = "admin-token"
)

// SecretStore is the credential store the profile secrets go to; nil means "file only".
type SecretStore interface {
	Get(profile, kind string) (string, error)
	Set(profile, kind, value string) error
	Delete(profile, kind string) error
}

func (p Profile) isVaulted(kind string) bool {
	for _, k := range p.Vaulted {
		if k == kind {
			return true
		}
	}
	return false
}

func (p *Profile) setVaulted(kind string, on bool) {
	var out []string
	for _, k := range p.Vaulted {
		if k != kind {
			out = append(out, k)
		}
	}
	if on {
		out = append(out, kind)
	}
	p.Vaulted = out
}

func (p *Profile) field(kind string) *string {
	if kind == KindAdmin {
		return &p.AdminToken
	}
	return &p.APIKey
}

// StoreSecret saves a secret: in the credential store when it works, otherwise in the private config file.
// It reports where it went. An empty value removes the secret everywhere. The caller still has to Save the file.
func (f *File) StoreSecret(s SecretStore, profile, kind, value string) (inStore bool, err error) {
	p := f.Profiles[profile]
	slot := p.field(kind)
	if value == "" {
		*slot = ""
		if s != nil && p.isVaulted(kind) {
			err = s.Delete(profile, kind)
		}
		p.setVaulted(kind, false)
		f.Profiles[profile] = p
		return false, err
	}
	if s != nil {
		if e := s.Set(profile, kind, value); e == nil {
			*slot = ""
			p.setVaulted(kind, true)
			f.Profiles[profile] = p
			return true, nil
		}
	}
	*slot = value
	p.setVaulted(kind, false)
	f.Profiles[profile] = p
	return false, nil
}

// Hydrate fills the secrets of r that live in the credential store. Environment variables already set in r win.
// A store that cannot be read is reported, not fatal: commands that need no secret keep working.
func (r *Resolved) Hydrate(f *File, s SecretStore) error {
	p := f.Profiles[r.Profile]
	var errs []error
	for _, kind := range []string{KindAPIKey, KindAdmin} {
		dst := &r.APIKey
		if kind == KindAdmin {
			dst = &r.AdminToken
		}
		if *dst != "" || !p.isVaulted(kind) {
			continue
		}
		if s == nil {
			errs = append(errs, fmt.Errorf("the %s is kept in the system keychain, which is not available here", kind))
			continue
		}
		v, err := s.Get(r.Profile, kind)
		if err != nil {
			errs = append(errs, fmt.Errorf("cannot read the %s from the system keychain: %w", kind, err))
			continue
		}
		*dst = v
	}
	return errors.Join(errs...)
}

// File is the on-disk configuration.
type File struct {
	// Rounded draws pills with half-circle ends (needs a Nerd Font). NAH_NERD_FONT overrides it.
	Rounded  bool               `json:"rounded,omitempty"`
	Current  string             `json:"current,omitempty"`
	Profiles map[string]Profile `json:"profiles,omitempty"`
}

// Path returns the configuration file location ($NAH_CONFIG, else the user config dir).
func Path() (string, error) {
	if p := os.Getenv("NAH_CONFIG"); p != "" {
		return p, nil
	}
	dir, err := paths.System().ConfigDir()
	if err != nil {
		return "", fmt.Errorf("cannot locate the user config directory: %w", err)
	}
	return filepath.Join(dir, "config.json"), nil
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
	Profile     string
	URL         string
	APIKey      string
	AdminToken  string
	AccountName string
	Device      string
	DownloadDir string
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

		AccountName: p.AccountName,
		Device:      p.Device,
		DownloadDir: firstNonEmpty(getenv("NAH_DOWNLOAD_DIR"), p.DownloadDir),
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
