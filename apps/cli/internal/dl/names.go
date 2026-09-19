package dl

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

var windowsReserved = map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true}

func isReservedOnWindows(stem string) bool {
	up := strings.ToUpper(stem)
	if windowsReserved[up] {
		return true
	}
	if len(up) == 4 && (strings.HasPrefix(up, "COM") || strings.HasPrefix(up, "LPT")) && up[3] >= '1' && up[3] <= '9' {
		return true
	}
	return false
}

// SafeName turns a name suggested by a remote server into a file name that is valid on every platform we
// ship for: no directory parts (no path traversal), none of the characters Windows forbids, no control
// characters, no reserved device names, no trailing dots or spaces, at most 150 bytes, extension preserved.
// A name that is empty after cleaning becomes fallback.
func SafeName(name, fallback string) string {
	// The name may come with either kind of separator regardless of our OS: keep only the last element.
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		switch {
		case r < 0x20 || r == 0x7f || unicode.Is(unicode.Cf, r): // control and invisible format characters (bidi tricks)
			return -1
		case strings.ContainsRune(`<>:"|?*`, r):
			return '_'
		}
		return r
	}, name)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if name == "" || name == "." || name == ".." {
		if fallback == "" || fallback == name {
			return "download"
		}
		return SafeName(fallback, "download")
	}

	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if stem == "" { // ".hidden" style names: treat the whole thing as the stem
		stem, ext = name, ""
	}
	if isReservedOnWindows(stem) {
		stem = "_" + stem
	}
	// Leave room for " (99)" and ".part".
	const maxBytes = 150
	if len(ext) > 20 {
		ext = ext[:20]
	}
	for len(stem)+len(ext) > maxBytes {
		_, size := utf8.DecodeLastRuneInString(stem)
		stem = stem[:len(stem)-size]
	}
	stem = strings.TrimRight(stem, ". ")
	if stem == "" {
		stem = "download"
	}
	return stem + ext
}

// Unique returns path if nothing exists there, else "name (2).ext", "name (3).ext"… like a browser does.
func Unique(path string) string {
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return path
	}
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	for i := 2; i < 10_000; i++ {
		cand := fmt.Sprintf("%s (%d)%s", stem, i, ext)
		if _, err := os.Lstat(cand); os.IsNotExist(err) {
			return cand
		}
	}
	return path
}
