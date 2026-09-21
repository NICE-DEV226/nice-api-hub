package tui

import (
	"context"
	"image"
	"os"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/muesli/termenv"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/fsnav"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/opener"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/preview"
)

// Deps is everything the interface needs from the outside.
type Deps struct {
	Client      *api.Client
	Profile     string
	HasAPI      bool // an API key is configured: dashboard account panel and the playground work
	HasAdmin    bool // an admin token is configured: the accounts tab works
	Now         func() time.Time
	DownloadDir string
	// Refresh is the dashboard auto-refresh period (0 disables it).
	Refresh time.Duration
	// Thumb fetches and decodes a thumbnail; the default downloads it directly. Tests replace it.
	Thumb func(ctx context.Context, url string) (image.Image, error)
	// OpenURL opens a web page in the browser; the default uses the system's opener.
	OpenURL func(url string) error
	// FS is how the folder picker sees the file system; the zero value means the real one.
	FS fsnav.Env
	// Session lets the interface set this computer up (accounts, keys). Nil disables the setup screens.
	Session Session
	// Copy puts text on the clipboard. Defaults to the OSC 52 terminal escape.
	Copy func(string) tea.Cmd
}

func (d *Deps) defaults() {
	if d.Thumb == nil {
		client := preview.NewClient()
		d.Thumb = func(ctx context.Context, url string) (image.Image, error) { return preview.Fetch(ctx, client, url) }
	}
	if d.OpenURL == nil {
		d.OpenURL = opener.OpenURL
	}
	if d.FS.Home == nil {
		d.FS = fsnav.System()
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.DownloadDir == "" {
		d.DownloadDir = "."
	}
	if d.Copy == nil {
		d.Copy = copyOSC52
	}
}

// copyOSC52 copies via the terminal (works over SSH in most modern terminals, no xclip needed).
func copyOSC52(text string) tea.Cmd {
	return func() tea.Msg {
		termenv.NewOutput(os.Stdout).Copy(text)
		return nil
	}
}

// view is one tab of the application.
type view interface {
	Init() tea.Cmd
	// Update handles a message and returns follow-up commands. Views mutate themselves.
	Update(msg tea.Msg) tea.Cmd
	View() string
	SetSize(w, h int)
	// Capturing reports whether the view is editing text (global shortcuts must stay out of the way).
	Capturing() bool
	// Activated is called when the tab becomes visible.
	Activated() tea.Cmd
	Help() []key.Binding
}

// flash is a short-lived status line.
type flash struct {
	text string
	bad  bool
	at   time.Time
}

func (f *flash) set(now time.Time, text string, bad bool) { f.text, f.bad, f.at = text, bad, now }

func (f flash) visible(now time.Time) bool { return f.text != "" && now.Sub(f.at) < 6*time.Second }
