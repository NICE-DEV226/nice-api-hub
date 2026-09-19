// Package clip copies text to the user's clipboard on every platform we ship for.
//
// The system clipboard is tried first (pbcopy on macOS, the Win32 API on Windows, wl-copy/xclip/xsel on
// Linux). Where none exists (an SSH session, a bare server) it falls back to OSC 52, an escape sequence most
// modern terminals turn into a clipboard write on the *local* machine, which is exactly what you want over SSH.
package clip

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"

	sysclip "github.com/atotto/clipboard"
)

// Method says how a copy was done.
type Method string

const (
	System Method = "clipboard"
	OSC52  Method = "terminal"
	None   Method = ""
)

// Copier can be swapped in tests.
type Copier struct {
	// Write is the system clipboard; nil means the real one.
	Write func(string) error
	// Out receives the OSC 52 sequence; nil means os.Stdout. Set OSC52Off to disable the fallback.
	Out      io.Writer
	OSC52Off bool
}

// Copy puts text on the clipboard and reports how.
func (c Copier) Copy(text string) (Method, error) {
	write := c.Write
	if write == nil {
		write = sysclip.WriteAll
	}
	if err := write(text); err == nil {
		return System, nil
	}
	if c.OSC52Off {
		return None, fmt.Errorf("no clipboard available")
	}
	out := c.Out
	if out == nil {
		out = os.Stdout
	}
	if _, err := io.WriteString(out, OSC52Sequence(text)); err != nil {
		return None, err
	}
	return OSC52, nil
}

// maxOSC52 keeps the payload under what terminals accept (xterm caps around 100 kB).
const maxOSC52 = 74_000

// OSC52Sequence is the escape sequence that asks the terminal to set the clipboard.
func OSC52Sequence(text string) string {
	if len(text) > maxOSC52 {
		text = text[:maxOSC52]
	}
	return "\x1b]52;c;" + base64.StdEncoding.EncodeToString([]byte(text)) + "\x07"
}
