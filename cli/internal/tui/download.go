package tui

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/dl"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

// DownloadOptions describes one download.
type DownloadOptions struct {
	Client   *api.Client
	Request  api.DownloadRequest
	Dest     string // file, directory, or empty for the current directory
	Fallback string // file name when the gateway suggests none
	Force    bool
	// Unique saves "name (2).ext" instead of failing when the file exists (interactive use).
	Unique bool
}

// DownloadResult is what was saved.
type DownloadResult struct {
	Path     string
	Bytes    int64
	Provider string
	Elapsed  time.Duration
}

// Transfer runs the download and reports progress; it is the single code path used by the CLI
// command (with a progress bar) and by the full-screen app (which renders its own bar).
func Transfer(ctx context.Context, o DownloadOptions, onStart func(*api.DownloadStream), onProgress dl.Progress) (DownloadResult, error) {
	start := time.Now()
	s, err := o.Client.Download(ctx, o.Request)
	if err != nil {
		return DownloadResult{}, err
	}
	defer s.Close()
	if onStart != nil {
		onStart(s)
	}
	save := func() (string, int64, error) { return dl.Save(ctx, s, o.Dest, o.Fallback, o.Force, onProgress) }
	if o.Unique {
		save = func() (string, int64, error) { return dl.SaveUnique(ctx, s, o.Dest, o.Fallback, onProgress) }
	}
	path, n, err := save()
	if err != nil {
		return DownloadResult{Path: path, Bytes: n, Provider: s.Provider}, err
	}
	return DownloadResult{Path: path, Bytes: n, Provider: s.Provider, Elapsed: time.Since(start)}, nil
}

// ---- progress bar model ----------------------------------------------------------

type dlEvent struct {
	kind  string // start | progress | done
	done  int64
	total int64
	name  string
	res   DownloadResult
	err   error
}

type dlModel struct {
	events   <-chan dlEvent
	spin     spinner.Model
	bar      progress.Model
	cancel   context.CancelFunc
	started  time.Time
	phase    string
	name     string
	done     int64
	total    int64
	finished bool
	res      DownloadResult
	err      error
	speed    speedMeter
}

type speedMeter struct {
	at    time.Time
	bytes int64
	bps   float64
}

func (s *speedMeter) add(now time.Time, total int64) {
	if s.at.IsZero() {
		s.at, s.bytes = now, total
		return
	}
	if dt := now.Sub(s.at).Seconds(); dt >= 0.5 {
		inst := float64(total-s.bytes) / dt
		if s.bps == 0 {
			s.bps = inst
		} else {
			s.bps = 0.6*s.bps + 0.4*inst // smoothed
		}
		s.at, s.bytes = now, total
	}
}

func waitEvent(ch <-chan dlEvent) tea.Cmd { return func() tea.Msg { return <-ch } }

func (m dlModel) Init() tea.Cmd { return tea.Batch(m.spin.Tick, waitEvent(m.events)) }

func (m dlModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case dlEvent:
		switch msg.kind {
		case "start":
			m.phase, m.name, m.total = "transfer", msg.name, msg.total
			return m, waitEvent(m.events)
		case "progress":
			m.done, m.total = msg.done, msg.total
			m.speed.add(time.Now(), msg.done)
			return m, waitEvent(m.events)
		case "done":
			m.finished, m.res, m.err = true, msg.res, msg.err
			return m, tea.Quit
		}
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.cancel()
		}
	case progress.FrameMsg:
		pm, cmd := m.bar.Update(msg)
		m.bar = pm.(progress.Model)
		return m, cmd
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m dlModel) View() string {
	if m.finished {
		return ""
	}
	if m.phase != "transfer" {
		return m.spin.View() + " Resolving and preparing the media " + ui.MutedText.Render("(extraction can take ~10 s)") + "\n"
	}
	rate := ""
	if m.speed.bps > 0 {
		rate = "  " + ui.Bytes(int64(m.speed.bps)) + "/s"
	}
	if m.total > 0 {
		return fmt.Sprintf("%s\n%s %s / %s%s\n", ui.Bold.Render(m.name), m.bar.ViewAs(float64(m.done)/float64(m.total)),
			ui.Bytes(m.done), ui.Bytes(m.total), rate)
	}
	// Merged / transcoded streams have no known length.
	return fmt.Sprintf("%s\n%s %s streamed%s %s\n", ui.Bold.Render(m.name), m.spin.View(), ui.Bytes(m.done), rate,
		ui.MutedText.Render("(size unknown: merged on the fly)"))
}

// RunDownload downloads with a live progress bar drawn on w (stderr). Use it when w is a terminal.
func RunDownload(ctx context.Context, w io.Writer, o DownloadOptions) (DownloadResult, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	events := make(chan dlEvent, 32)

	sp := spinner.New(spinner.WithSpinner(spinner.MiniDot), spinner.WithStyle(ui.Title))
	bar := newBar(40)
	m := dlModel{events: events, spin: sp, bar: bar, cancel: cancel, started: time.Now(), phase: "prepare"}
	p := tea.NewProgram(m, tea.WithOutput(w))

	go func() {
		res, err := Transfer(ctx, o,
			func(s *api.DownloadStream) {
				name := s.Filename
				if name == "" {
					name = o.Fallback
				}
				events <- dlEvent{kind: "start", name: name, total: s.ContentLength}
			},
			func(done, total int64) {
				select {
				case events <- dlEvent{kind: "progress", done: done, total: total}:
				default: // never block the copy loop on a slow terminal
				}
			})
		events <- dlEvent{kind: "done", res: res, err: err}
	}()

	final, err := p.Run()
	if err != nil {
		return DownloadResult{}, err
	}
	fm := final.(dlModel)
	if fm.err != nil {
		return fm.res, fm.err
	}
	return fm.res, ctx.Err()
}

// RunDownloadPlain downloads without any terminal control sequences (pipes, CI, logs).
func RunDownloadPlain(ctx context.Context, w io.Writer, o DownloadOptions, quiet bool) (DownloadResult, error) {
	var lastPct int64 = -1
	res, err := Transfer(ctx, o,
		func(s *api.DownloadStream) {
			if !quiet {
				size := "size unknown"
				if s.ContentLength > 0 {
					size = ui.Bytes(s.ContentLength)
				}
				fmt.Fprintf(w, "downloading %s (%s)\n", strings.TrimSpace(s.Filename), size)
			}
		},
		func(done, total int64) {
			if quiet || total <= 0 {
				return
			}
			if pct := done * 10 / total; pct != lastPct {
				lastPct = pct
				fmt.Fprintf(w, "  %d%%\n", pct*10)
			}
		})
	return res, err
}
