package tui

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/table"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/dl"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

type resolvedMsg struct {
	res *api.MediaResult
	err error
}

type dlStartMsg struct {
	ch     <-chan dlEvent
	cancel context.CancelFunc
}

const (
	pgInput = iota
	pgResolving
	pgResult
	pgDownloading
)

type playground struct {
	d     Deps
	w, h  int
	state int

	in  textinput.Model
	sp  spinner.Model
	bar progress.Model
	tbl table.Model

	res    *api.MediaResult
	cancel context.CancelFunc // cancels the resolve in flight
	toast  flash

	dl struct {
		name    string
		done    int64
		total   int64
		ch      <-chan dlEvent
		cancel  context.CancelFunc
		speed   speedMeter
		started time.Time
	}
}

func newPlayground(d Deps) *playground {
	in := textinput.New()
	in.Placeholder = "Paste a media URL (YouTube, TikTok, X, Instagram, SoundCloud…)"
	in.CharLimit = 2048
	in.Prompt = "▸ "
	in.PromptStyle = ui.Title
	in.Focus()
	m := &playground{
		d:   d,
		in:  in,
		sp:  spinner.New(spinner.WithSpinner(spinner.MiniDot), spinner.WithStyle(ui.Title)),
		bar: progress.New(progress.WithDefaultGradient(), progress.WithWidth(40), progress.WithoutPercentage()),
	}
	m.tbl = table.New(table.WithColumns(variantColumns(80)), table.WithFocused(true), table.WithHeight(10))
	styleTable(&m.tbl, true)
	return m
}

func variantColumns(w int) []table.Column {
	return []table.Column{
		{Title: "#", Width: 3}, {Title: "KIND", Width: 5}, {Title: "QUALITY", Width: 9}, {Title: "CODEC", Width: 6},
		{Title: "SIZE", Width: 8}, {Title: "AUDIO", Width: 5}, {Title: "PROTO", Width: 6}, {Title: "EXT", Width: 4},
	}
}

func (m *playground) Capturing() bool { return m.state == pgInput }
func (m *playground) Activated() tea.Cmd {
	return textinput.Blink
}

func (m *playground) Init() tea.Cmd { return textinput.Blink }

// Close cancels any work in flight (called when the app quits).
func (m *playground) Close() {
	if m.cancel != nil {
		m.cancel()
	}
	if m.dl.cancel != nil {
		m.dl.cancel()
	}
}

func (m *playground) SetSize(w, h int) {
	m.w, m.h = w, h
	m.in.Width = maxInt(20, w-8)
	m.tbl.SetWidth(w - 6)
	m.tbl.SetHeight(maxInt(4, h-10))
}

func (m *playground) Help() []key.Binding {
	b := func(k, h string) key.Binding { return key.NewBinding(key.WithKeys(k), key.WithHelp(k, h)) }
	switch m.state {
	case pgInput:
		return []key.Binding{b("enter", "resolve"), b("ctrl+u", "clear")}
	case pgResolving:
		return []key.Binding{b("esc", "cancel")}
	case pgDownloading:
		return []key.Binding{b("esc", "cancel download")}
	}
	return []key.Binding{b("↑/↓", "select"), b("d", "download"), b("m", "mp3"), b("c", "copy link"), b("esc", "new URL")}
}

func (m *playground) resolve(url string) tea.Cmd {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	m.cancel = cancel
	m.state, m.res = pgResolving, nil
	c := m.d.Client
	return tea.Batch(m.sp.Tick, func() tea.Msg {
		defer cancel()
		res, err := c.Media(ctx, url)
		return resolvedMsg{res: res, err: err}
	})
}

func (m *playground) buildRows() {
	rows := make([]table.Row, len(m.res.Data.Variants))
	for i, v := range m.res.Data.Variants {
		audio := "—"
		if v.Kind == "video" {
			switch {
			case v.HasAudio == nil:
				audio = "?"
			case *v.HasAudio:
				audio = "yes"
			default:
				audio = "no"
			}
		}
		size := "—"
		if v.SizeBytes > 0 {
			size = ui.Bytes(v.SizeBytes)
		}
		proto := v.Protocol
		if proto == "" {
			proto = "direct"
		}
		q := v.Quality
		if q == "" {
			q = ui.Truncate(v.Label, 10)
		}
		rows[i] = table.Row{fmt.Sprint(i + 1), v.Kind, dashIfEmpty(q), dashIfEmpty(v.Codec), size, audio, proto, dashIfEmpty(v.Ext)}
	}
	m.tbl.SetRows(rows)
	m.tbl.SetCursor(0)
}

func dashIfEmpty(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

func (m *playground) selectedVariant() *api.Variant {
	if m.res == nil {
		return nil
	}
	i := m.tbl.Cursor()
	if i < 0 || i >= len(m.res.Data.Variants) {
		return nil
	}
	return &m.res.Data.Variants[i]
}

// downloadRequest maps the highlighted row to what /v1/download understands.
func downloadRequest(url string, v api.Variant, mp3 bool) (api.DownloadRequest, string) {
	if mp3 {
		return api.DownloadRequest{URL: url, Kind: "audio", AudioFormat: "mp3"}, "nah-download.mp3"
	}
	if v.Kind == "audio" {
		return api.DownloadRequest{URL: url, Kind: "audio"}, "nah-download.m4a"
	}
	return api.DownloadRequest{URL: url, Kind: "video", MaxHeight: v.Height}, "nah-download.mp4"
}

func (m *playground) startDownload(req api.DownloadRequest, fallback string) tea.Cmd {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan dlEvent, 32)
	opts := DownloadOptions{Client: m.d.Client, Request: req, Dest: m.d.DownloadDir, Fallback: fallback}
	m.dl.name, m.dl.done, m.dl.total, m.dl.speed, m.dl.started = "", 0, -1, speedMeter{}, m.d.Now()
	m.state = pgDownloading
	go func() {
		res, err := Transfer(ctx, opts,
			func(s *api.DownloadStream) {
				name := s.Filename
				if name == "" {
					name = fallback
				}
				ch <- dlEvent{kind: "start", name: name, total: s.ContentLength}
			},
			func(done, total int64) {
				select {
				case ch <- dlEvent{kind: "progress", done: done, total: total}:
				default:
				}
			})
		ch <- dlEvent{kind: "done", res: res, err: err}
	}()
	return func() tea.Msg { return dlStartMsg{ch: ch, cancel: cancel} }
}

func (m *playground) Update(msg tea.Msg) tea.Cmd {
	now := m.d.Now()
	switch msg := msg.(type) {
	case resolvedMsg:
		m.cancel = nil
		if m.state != pgResolving {
			return nil
		}
		if msg.err != nil {
			m.state = pgInput
			m.in.Focus()
			text := msg.err.Error()
			var p *api.Problem
			if errors.As(msg.err, &p) && p.Hint() != "" {
				text += " — " + p.Hint()
			}
			m.toast.set(now, text, true)
			return textinput.Blink
		}
		m.res, m.state = msg.res, pgResult
		m.in.Blur()
		m.buildRows()
		m.toast = flash{}
	case dlStartMsg:
		m.dl.ch, m.dl.cancel = msg.ch, msg.cancel
		return tea.Batch(m.sp.Tick, waitEvent(msg.ch))
	case dlEvent:
		if m.state != pgDownloading {
			return nil
		}
		switch msg.kind {
		case "start":
			m.dl.name, m.dl.total = msg.name, msg.total
			return waitEvent(m.dl.ch)
		case "progress":
			m.dl.done, m.dl.total = msg.done, msg.total
			m.dl.speed.add(now, msg.done)
			return waitEvent(m.dl.ch)
		case "done":
			m.state = pgResult
			m.dl.cancel, m.dl.ch = nil, nil
			switch {
			case errors.Is(msg.err, context.Canceled):
				m.toast.set(now, "Download cancelled.", true)
			case errors.Is(msg.err, dl.ErrExists):
				m.toast.set(now, "That file already exists here; move it away and retry.", true)
			case msg.err != nil:
				m.toast.set(now, "Download failed: "+msg.err.Error(), true)
			default:
				m.toast.set(now, fmt.Sprintf("Saved %s (%s in %s)", msg.res.Path, ui.Bytes(msg.res.Bytes), msg.res.Elapsed.Round(100*time.Millisecond)), false)
			}
		}
	case spinner.TickMsg:
		if m.state == pgResolving || m.state == pgDownloading {
			var cmd tea.Cmd
			m.sp, cmd = m.sp.Update(msg)
			return cmd
		}
	case tea.KeyMsg:
		return m.onKey(msg)
	}
	return nil
}

func (m *playground) onKey(msg tea.KeyMsg) tea.Cmd {
	now := m.d.Now()
	k := msg.String()
	switch m.state {
	case pgInput:
		if k == "enter" {
			url := strings.TrimSpace(m.in.Value())
			if url == "" {
				return nil
			}
			m.toast = flash{}
			return m.resolve(url)
		}
		var cmd tea.Cmd
		m.in, cmd = m.in.Update(msg)
		return cmd
	case pgResolving:
		if k == "esc" && m.cancel != nil {
			m.cancel()
			m.state = pgInput
			m.in.Focus()
			m.toast.set(now, "Cancelled.", true)
			return textinput.Blink
		}
	case pgDownloading:
		if k == "esc" && m.dl.cancel != nil {
			m.dl.cancel()
		}
	case pgResult:
		switch k {
		case "esc", "/":
			m.state = pgInput
			m.in.Focus()
			return textinput.Blink
		case "d", "enter":
			if v := m.selectedVariant(); v != nil {
				req, fb := downloadRequest(m.res.Data.SourceURL, *v, false)
				return m.startDownload(req, fb)
			}
		case "m":
			if v := m.selectedVariant(); v != nil {
				req, fb := downloadRequest(m.res.Data.SourceURL, *v, true)
				return m.startDownload(req, fb)
			}
		case "c":
			if v := m.selectedVariant(); v != nil {
				m.toast.set(now, "Link copied (if your terminal supports OSC 52).", false)
				return m.d.Copy(v.URL)
			}
		default:
			var cmd tea.Cmd
			m.tbl, cmd = m.tbl.Update(msg)
			return cmd
		}
	}
	return nil
}

func (m *playground) View() string {
	var b strings.Builder
	b.WriteString(ui.PanelHot.Width(maxInt(20, m.w-2)).Render(m.in.View()))
	b.WriteString("\n")

	switch m.state {
	case pgResolving:
		b.WriteString("\n " + m.sp.View() + " Resolving… " + ui.MutedText.Render("(extraction can take ~10 s)"))
	case pgDownloading:
		b.WriteString("\n" + m.downloadView())
	case pgResult:
		b.WriteString(m.resultView())
	default:
		b.WriteString("\n" + ui.MutedText.Render(" Supported: YouTube, TikTok, X, Instagram, Facebook, SoundCloud, Bluesky, Dailymotion, LinkedIn, Pinterest"))
	}

	if m.toast.visible(m.d.Now()) {
		style := ui.OK
		if m.toast.bad {
			style = ui.Danger
		}
		b.WriteString("\n\n " + style.Render(ui.Truncate(m.toast.text, m.w-4)))
	}
	return b.String()
}

func (m *playground) resultView() string {
	d := m.res.Data
	dur := ""
	if d.DurationSeconds != nil {
		dur = ui.Duration(*d.DurationSeconds)
	}
	sub := joinDot(ui.Deref(d.Author, ""), dur, d.Platform, "via "+d.Provider, fmt.Sprintf("%d ms", m.res.Meta.TookMs))
	line := ui.MutedText.Render(sub)
	if m.res.Meta.Cached {
		line += " " + ui.Badge.Render("cached")
	}
	head := ui.Bold.Render(ui.OneLine(ui.Deref(d.Title, "(untitled)"), maxInt(20, m.w-4)))
	return "\n " + head + "\n " + line + "\n\n" + indent(m.tbl.View(), " ")
}

func joinDot(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, " · ")
}

func (m *playground) downloadView() string {
	name := m.dl.name
	if name == "" {
		return " " + m.sp.View() + " Preparing the file… " + ui.MutedText.Render("(esc to cancel)")
	}
	rate := ""
	if m.dl.speed.bps > 0 {
		rate = "  " + ui.Bytes(int64(m.dl.speed.bps)) + "/s"
	}
	if m.dl.total > 0 {
		pct := float64(m.dl.done) / float64(m.dl.total)
		return fmt.Sprintf(" %s\n %s %3.0f%%  %s / %s%s", ui.Bold.Render(name), m.bar.ViewAs(pct), pct*100, ui.Bytes(m.dl.done), ui.Bytes(m.dl.total), rate)
	}
	return fmt.Sprintf(" %s\n %s %s streamed%s  %s", ui.Bold.Render(name), m.sp.View(), ui.Bytes(m.dl.done), rate, ui.MutedText.Render("(merged on the fly, size unknown)"))
}

var _ = lipgloss.Left
