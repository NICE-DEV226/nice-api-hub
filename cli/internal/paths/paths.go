// Package paths decides where the CLI keeps things on each operating system, following each
// platform's convention instead of a Unix-only one.
package paths

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
)

// Env is what path resolution needs from the outside; tests swap it to emulate other systems.
type Env struct {
	GOOS   string
	Getenv func(string) string
	Home   func() (string, error)
	// UserConfigDir mirrors os.UserConfigDir for the emulated GOOS.
	UserConfigDir func() (string, error)
	IsDir         func(string) bool
}

// System returns the real environment.
func System() Env {
	return Env{
		GOOS:          runtime.GOOS,
		Getenv:        os.Getenv,
		Home:          os.UserHomeDir,
		UserConfigDir: os.UserConfigDir,
		IsDir: func(p string) bool {
			st, err := os.Stat(p)
			return err == nil && st.IsDir()
		},
	}
}

// ConfigDir holds settings (URL, account info). $NAH_CONFIG_DIR overrides it.
//
//	Linux   ~/.config/nah            macOS  ~/Library/Application Support/nah      Windows  %AppData%\nah
func (e Env) ConfigDir() (string, error) {
	if d := e.Getenv("NAH_CONFIG_DIR"); d != "" {
		return d, nil
	}
	base, err := e.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "nah"), nil
}

// DataDir holds data the app produces (download history, the fallback install id). $NAH_DATA_DIR overrides it.
//
//	Linux   $XDG_DATA_HOME or ~/.local/share/nah     macOS  ~/Library/Application Support/nah
//	Windows %LocalAppData%\nah   (local, not roamed: history and ids are per computer)
func (e Env) DataDir() (string, error) {
	if d := e.Getenv("NAH_DATA_DIR"); d != "" {
		return d, nil
	}
	switch e.GOOS {
	case "windows":
		if d := e.Getenv("LocalAppData"); d != "" {
			return filepath.Join(d, "nah"), nil
		}
	case "darwin":
		// falls through to the config location: macOS has one "Application Support" for both
	default:
		if d := e.Getenv("XDG_DATA_HOME"); d != "" {
			return filepath.Join(d, "nah"), nil
		}
		home, err := e.Home()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".local", "share", "nah"), nil
	}
	return e.ConfigDir()
}

// DownloadsDir is where downloads go by default: $NAH_DOWNLOAD_DIR, else the user's Downloads folder,
// else the current directory (servers and containers often have no Downloads folder).
func (e Env) DownloadsDir() string {
	if d := e.Getenv("NAH_DOWNLOAD_DIR"); d != "" {
		return d
	}
	if home, err := e.Home(); err == nil {
		if d := filepath.Join(home, "Downloads"); e.IsDir(d) {
			return d
		}
	}
	return "."
}

// ErrNoHome is returned when no home directory can be determined.
var ErrNoHome = errors.New("cannot determine the home directory")
