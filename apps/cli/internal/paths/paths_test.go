package paths

import (
	"path/filepath"
	"testing"
)

func env(goos string, vars map[string]string, home string, dirs ...string) Env {
	isDir := map[string]bool{}
	for _, d := range dirs {
		isDir[d] = true
	}
	return Env{
		GOOS:   goos,
		Getenv: func(k string) string { return vars[k] },
		Home:   func() (string, error) { return home, nil },
		UserConfigDir: func() (string, error) {
			switch goos {
			case "windows":
				return vars["AppData"], nil
			case "darwin":
				return filepath.Join(home, "Library", "Application Support"), nil
			}
			if x := vars["XDG_CONFIG_HOME"]; x != "" {
				return x, nil
			}
			return filepath.Join(home, ".config"), nil
		},
		IsDir: func(p string) bool { return isDir[p] },
	}
}

func TestConfigAndDataDirsFollowEachPlatformsConvention(t *testing.T) {
	cases := []struct {
		name         string
		e            Env
		config, data string
	}{
		{"linux", env("linux", nil, "/home/ada"), "/home/ada/.config/nah", "/home/ada/.local/share/nah"},
		{"linux with XDG", env("linux", map[string]string{"XDG_CONFIG_HOME": "/x/cfg", "XDG_DATA_HOME": "/x/data"}, "/home/ada"), "/x/cfg/nah", "/x/data/nah"},
		{"macOS", env("darwin", nil, "/Users/ada"), "/Users/ada/Library/Application Support/nah", "/Users/ada/Library/Application Support/nah"},
		{"windows", env("windows", map[string]string{"AppData": `C:\Users\ada\AppData\Roaming`, "LocalAppData": `C:\Users\ada\AppData\Local`}, `C:\Users\ada`),
			filepath.Join(`C:\Users\ada\AppData\Roaming`, "nah"), filepath.Join(`C:\Users\ada\AppData\Local`, "nah")},
	}
	for _, c := range cases {
		gotC, err := c.e.ConfigDir()
		if err != nil || gotC != c.config {
			t.Errorf("%s config: %q %v want %q", c.name, gotC, err, c.config)
		}
		gotD, err := c.e.DataDir()
		if err != nil || gotD != c.data {
			t.Errorf("%s data: %q %v want %q", c.name, gotD, err, c.data)
		}
	}
}

func TestOverridesWin(t *testing.T) {
	e := env("linux", map[string]string{"NAH_CONFIG_DIR": "/custom/c", "NAH_DATA_DIR": "/custom/d", "NAH_DOWNLOAD_DIR": "/custom/dl"}, "/home/ada")
	if d, _ := e.ConfigDir(); d != "/custom/c" {
		t.Error(d)
	}
	if d, _ := e.DataDir(); d != "/custom/d" {
		t.Error(d)
	}
	if e.DownloadsDir() != "/custom/dl" {
		t.Error(e.DownloadsDir())
	}
}

func TestDownloadsDirFallsBackToCwdOnHeadlessSystems(t *testing.T) {
	home := "/home/ada"
	if got := env("linux", nil, home, filepath.Join(home, "Downloads")).DownloadsDir(); got != filepath.Join(home, "Downloads") {
		t.Errorf("uses ~/Downloads when it exists: %q", got)
	}
	if got := env("linux", nil, home).DownloadsDir(); got != "." {
		t.Errorf("no Downloads folder (server, container): current directory, got %q", got)
	}
}
