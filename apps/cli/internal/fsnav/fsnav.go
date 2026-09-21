// Package fsnav is the file-system side of the folder picker: listing folders, breadcrumbs, the usual places
// (Downloads, Documents, external drives…) on each operating system, path completion, and creating a folder.
// It has no terminal code, so it is tested on its own.
package fsnav

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/dl"
)

// Env is what navigation needs from the system; tests replace it to emulate another OS.
type Env struct {
	GOOS   string
	Home   func() (string, error)
	Getenv func(string) string
	IsDir  func(string) bool
	// Drives lists the Windows drive roots that exist ("C:\", "D:\"). Unused elsewhere.
	Drives func() []string
}

// System returns the real environment.
func System() Env {
	return Env{
		GOOS:   runtime.GOOS,
		Home:   os.UserHomeDir,
		Getenv: os.Getenv,
		IsDir:  isDir,
		Drives: windowsDrives,
	}
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func windowsDrives() []string {
	var out []string
	for c := 'A'; c <= 'Z'; c++ {
		root := string(c) + `:\`
		if _, err := os.Stat(root); err == nil {
			out = append(out, root)
		}
	}
	return out
}

// Entry is one sub-folder.
type Entry struct {
	Name   string
	Path   string
	Hidden bool
}

// List returns the sub-folders of dir (symlinks to folders included), sorted without regard to case. Files are
// never listed: this is a folder picker. Hidden folders (leading dot) only when asked for.
func List(dir string, hidden bool) ([]Entry, error) {
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(items))
	for _, it := range items {
		p := filepath.Join(dir, it.Name())
		if !it.IsDir() {
			if it.Type()&os.ModeSymlink == 0 || !isDir(p) {
				continue
			}
		}
		h := strings.HasPrefix(it.Name(), ".")
		if h && !hidden {
			continue
		}
		out = append(out, Entry{Name: it.Name(), Path: p, Hidden: h})
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if a != b {
			return a < b
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// Parent is the folder above dir; at a root it returns dir itself.
func Parent(dir string) string { return filepath.Dir(filepath.Clean(dir)) }

// Crumb is one clickable segment of the path shown above the list.
type Crumb struct {
	Label string
	Path  string
}

// Crumbs splits dir into segments, replacing the home folder by "~" so the common case stays short.
func Crumbs(dir, home string) []Crumb {
	dir = filepath.Clean(dir)
	var out []Crumb
	rest := dir
	base := ""
	if home != "" {
		h := filepath.Clean(home)
		if dir == h || strings.HasPrefix(dir, h+string(filepath.Separator)) {
			out = append(out, Crumb{"~", h})
			rest, base = strings.TrimPrefix(dir, h), h
		}
	}
	if base == "" {
		vol := filepath.VolumeName(dir)
		root := vol + string(filepath.Separator)
		label := root
		if vol != "" {
			label = vol
		}
		out = append(out, Crumb{label, root})
		rest, base = strings.TrimPrefix(dir, root), root
	}
	cur := base
	for _, part := range strings.Split(strings.Trim(rest, string(filepath.Separator)), string(filepath.Separator)) {
		if part == "" {
			continue
		}
		cur = filepath.Join(cur, part)
		out = append(out, Crumb{part, cur})
	}
	return out
}

// Place is a shortcut to a folder people often want.
type Place struct {
	Label string
	Path  string
}

// Places lists the shortcuts that exist on this computer, most useful first. recent are folders the person
// chose before (most recent first) and come first. downloads is the configured default download folder.
func Places(e Env, downloads string, recent []string) []Place {
	var out []Place
	seen := map[string]bool{}
	add := func(label, path string) {
		if path == "" || seen[filepath.Clean(path)] || !e.IsDir(path) {
			return
		}
		seen[filepath.Clean(path)] = true
		out = append(out, Place{label, path})
	}
	home, _ := e.Home()
	for i, r := range recent {
		if i >= 3 {
			break
		}
		add("» "+filepath.Base(r), r)
	}
	if downloads != "" {
		label := "Default"
		if home != "" && filepath.Clean(downloads) == filepath.Join(home, "Downloads") {
			label = "Downloads"
		}
		add(label, downloads)
	}
	if home != "" {
		add("Downloads", filepath.Join(home, "Downloads"))
		add("Desktop", filepath.Join(home, "Desktop"))
		add("Documents", filepath.Join(home, "Documents"))
		video := "Videos"
		if e.GOOS == "darwin" {
			video = "Movies"
		}
		add(video, filepath.Join(home, video))
		add("Music", filepath.Join(home, "Music"))
		add("Pictures", filepath.Join(home, "Pictures"))
		add("Home", home)
	}
	switch e.GOOS {
	case "windows":
		if e.Drives != nil {
			for _, d := range e.Drives() {
				add(strings.TrimSuffix(d, `\`), d)
			}
		}
	case "darwin":
		add("Volumes", "/Volumes")
		add("/", "/")
	default:
		user := e.Getenv("USER")
		for _, base := range []string{"/run/media/" + user, "/media/" + user, "/media", "/mnt"} {
			if user == "" && strings.HasSuffix(base, "/") {
				continue
			}
			if e.IsDir(base) {
				add("Drives", base)
				break
			}
		}
		add("/", "/")
	}
	return out
}

// Expand turns "~", "~/x" and "~\x" into paths under home; other input is returned as typed.
func Expand(input, home string) string {
	if home == "" {
		return input
	}
	switch {
	case input == "~":
		return home
	case strings.HasPrefix(input, "~/"), strings.HasPrefix(input, `~\`):
		return filepath.Join(home, input[2:])
	}
	return input
}

// LooksLikePath tells a typed path ("/srv", "~/Videos", "C:\x", "..\y") from a filter word.
func LooksLikePath(s string) bool {
	if s == "" {
		return false
	}
	if s[0] == '/' || s[0] == '\\' || s[0] == '~' || strings.HasPrefix(s, "./") || strings.HasPrefix(s, "../") {
		return true
	}
	return len(s) >= 2 && s[1] == ':' && ((s[0] >= 'A' && s[0] <= 'Z') || (s[0] >= 'a' && s[0] <= 'z'))
}

// Complete finishes a typed path: it returns the longest common completion of the last segment among the
// sub-folders of what precedes it, and the matching folder names.
func Complete(input, home string, hidden bool) (completed string, matches []string) {
	full := Expand(input, home)
	dir, prefix := filepath.Split(full)
	if dir == "" {
		return input, nil
	}
	entries, err := List(dir, hidden || strings.HasPrefix(prefix, "."))
	if err != nil {
		return input, nil
	}
	for _, e := range entries {
		if strings.HasPrefix(strings.ToLower(e.Name), strings.ToLower(prefix)) {
			matches = append(matches, e.Name)
		}
	}
	if len(matches) == 0 {
		return input, nil
	}
	common := matches[0]
	for _, m := range matches[1:] {
		n := 0
		for n < len(common) && n < len(m) && strings.EqualFold(common[n:n+1], m[n:n+1]) {
			n++
		}
		common = common[:n]
	}
	completed = filepath.Join(dir, common)
	if len(matches) == 1 {
		completed += string(filepath.Separator)
	}
	// keep the "~" the person typed
	if home != "" && (strings.HasPrefix(input, "~/") || strings.HasPrefix(input, `~\`)) {
		completed = "~" + string(filepath.Separator) + strings.TrimPrefix(strings.TrimPrefix(completed, filepath.Clean(home)), string(filepath.Separator))
	}
	return completed, matches
}

// ErrBadName is returned for a folder name that cannot be created.
var ErrBadName = errors.New("a folder name cannot be empty or contain slashes")

// Mkdir creates a folder called name inside parent and returns its path. The name goes through the same
// cleaning as downloaded file names, so it is valid on every operating system.
func Mkdir(parent, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || strings.ContainsAny(name, `/\`) {
		return "", ErrBadName
	}
	clean := dl.SafeName(name, "")
	if clean == "" || clean == "download" && name != "download" {
		return "", ErrBadName
	}
	p := filepath.Join(parent, clean)
	if err := os.Mkdir(p, 0o755); err != nil {
		if errors.Is(err, os.ErrExist) && isDir(p) {
			return p, nil // it is already there: just go in
		}
		return "", err
	}
	return p, nil
}

// Writable reports whether files can be created in dir, by actually creating one.
func Writable(dir string) error {
	f, err := os.CreateTemp(dir, ".nah-write-test-*")
	if err != nil {
		return fmt.Errorf("cannot write in %s: %w", dir, unwrapPath(err))
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

func unwrapPath(err error) error {
	var pe *os.PathError
	if errors.As(err, &pe) {
		return pe.Err
	}
	return err
}

// Short shortens a path for display: home becomes "~", and the middle is elided to fit max cells.
func Short(path, home string, max int) string {
	if home != "" {
		h := filepath.Clean(home)
		if path == h {
			path = "~"
		} else if strings.HasPrefix(path, h+string(filepath.Separator)) {
			path = "~" + strings.TrimPrefix(path, h)
		}
	}
	r := []rune(path)
	if max < 8 || len(r) <= max {
		return path
	}
	keep := max - 1
	head := keep / 3
	return string(r[:head]) + "…" + string(r[len(r)-(keep-head):])
}
