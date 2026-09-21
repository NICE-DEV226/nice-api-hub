// Package opener opens a file, or shows it in the file manager, with whatever the platform provides.
package opener

import (
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Command returns the program and arguments that open path (reveal=false) or show it selected in the
// file manager (reveal=true) on goos.
func Command(goos, path string, reveal bool) (string, []string) {
	switch goos {
	case "darwin":
		if reveal {
			return "open", []string{"-R", path}
		}
		return "open", []string{path}
	case "windows":
		if reveal {
			// explorer wants "/select,<path>" as ONE argument and returns a non-zero exit code even on success
			return "explorer", []string{"/select," + path}
		}
		return "rundll32", []string{"url.dll,FileProtocolHandler", path}
	default:
		if reveal {
			path = filepath.Dir(path) // there is no portable "select this file" on Linux
		}
		return "xdg-open", []string{path}
	}
}

// runnable extensions: the file name comes from a remote server, and "open" on these would execute them.
var runnable = map[string]bool{
	".exe": true, ".bat": true, ".cmd": true, ".com": true, ".msi": true, ".scr": true, ".pif": true, ".lnk": true,
	".ps1": true, ".psm1": true, ".vbs": true, ".vbe": true, ".js": true, ".jse": true, ".wsf": true, ".hta": true,
	".jar": true, ".reg": true, ".sh": true, ".command": true, ".app": true, ".desktop": true, ".appimage": true, ".dmg": true,
}

// ErrRunnable is returned when asked to open something that would run code.
var ErrRunnable = errors.New("refusing to open a program: the file name came from a website. Use the folder view instead")

// Open launches the file with the default application. It refuses anything that would run as a program.
func Open(path string) error {
	if runnable[strings.ToLower(filepath.Ext(path))] {
		return ErrRunnable
	}
	return start(path, false)
}

// Reveal shows the file in the file manager.
func Reveal(path string) error { return start(path, true) }

func start(path string, reveal bool) error {
	if path == "" {
		return errors.New("no path")
	}
	name, args := Command(runtime.GOOS, path, reveal)
	cmd := exec.Command(name, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }() // reap the child; explorer.exe exits non-zero on success
	return nil
}

// OpenURL opens a web page in the default browser. Only http(s) links are accepted: the address comes from a
// remote service, and other schemes (file:, javascript:, custom handlers) could run something.
func OpenURL(url string) error {
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return errors.New("refusing to open a link that is not http(s)")
	}
	return start(url, false)
}
