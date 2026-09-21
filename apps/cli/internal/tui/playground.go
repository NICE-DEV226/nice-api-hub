package tui

import (
	"context"
	"errors"
	"fmt"
	"image"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/dl"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/fsnav"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

type resolvedMsg struct {
	res *api.MediaResult
	err error
}

// pendingDL is a download that has been chosen and is waiting for its folder.
type pendingDL struct {
	req      api.DownloadRequest
	fallback string
}

// thumbnail states
const (
	thumbNone = iota
	thumbLoading
	thumbReady
)

type thumbMsg struct {
	url string
	img image.Image
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

	in   textinput.Model
	sp   spinner.Model
	bar  progress.Model
	tbl  *grid
	acts actionBar

	// where things were drawn last, for the mouse (relative to the view's top-left)
	gridY, gridX, actsY int
	inputY              int
	inputH              int
	chipY               int
	chipX0, chipX1      int

	// dir is where downloads are saved; picker is the folder chooser while it is open
	dir    string
	picker *folderPicker
	// ask: starting a download first asks where to save it. pending is the download waiting for that answer.
	ask     bool
	pending *pendingDL

	res    *api.MediaResult
	opts   []dlOption         // what can be downloaded, in plain words
	cancel context.CancelFunc // cancels the resolve in flight

	// the thumbnail of the media being shown
	thumb      image.Image
	thumbState int
	thumbTo    context.CancelFunc
	thumbLines []string // rendered for thumbCols x thumbRows
	thumbCols  int
	thumbRows  int
	thumbKey   [2]int // the box the cached lines were drawn for
	toast      flash

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
	in.Placeholder = "Paste a media URL here"
	in.CharLimit = 2048
	in.Prompt = "▸ "
	in.Focus()
	m := &playground{
		d:   d,
		in:  in,
		sp:  spinner.New(spinner.WithSpinner(spinner.MiniDot), spinner.WithStyle(ui.Title)),
		bar: newBar(40),
		dir: d.DownloadDir,
		ask: d.Session != nil && d.Session.AskWhereToSave(),
	}
	m.tbl = newGrid([]string{"DOWNLOAD AS", "DETAILS"}, []int{0, 24})
	return m
}

func (m *playground) Capturing() bool { return m.state == pgInput || m.picker != nil }
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
	m.tbl.SetSize(maxInt(20, w-2), maxInt(4, h-13))
}

func (m *playground) Help() []key.Binding {
	b := func(k, h string) key.Binding { return key.NewBinding(key.WithKeys(k), key.WithHelp(k, h)) }
	if m.picker != nil {
		return []key.Binding{b("enter", "open / confirm"), b("←", "up"), b("↑", "shortcuts"), b("+", "new folder"), b("esc", "cancel")}
	}
	switch m.state {
	case pgInput:
		return []key.Binding{b("enter", "resolve"), b("tab", "save folder"), b("ctrl+u", "clear")}
	case pgResolving:
		return []key.Binding{b("esc", "cancel")}
	case pgDownloading:
		return []key.Binding{b("esc", "cancel download")}
	}
	return []key.Binding{b("↑/↓", "select"), b("d", "download"), b("m", "mp3"), b("o", "open page"), b("f", "folder"), b("c", "copy link"), b("esc", "new URL")}
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

// buildRows fills the quality list from the resolved media.
func (m *playground) buildRows() {
	m.opts = buildOptions(m.res.Data)
	rows := make([][]string, len(m.opts))
	for i, o := range m.opts {
		rows[i] = []string{o.Label, o.Detail}
	}
	m.tbl.SetRows(rows)
	m.tbl.SetCursor(0)
}

func (m *playground) selectedOption() *dlOption {
	i := m.tbl.Cursor()
	if m.res == nil || i < 0 || i >= len(m.opts) {
		return nil
	}
	return &m.opts[i]
}

func (m *playground) startDownload(req api.DownloadRequest, fallback string) tea.Cmd {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan dlEvent, 32)
	opts := DownloadOptions{Client: m.d.Client, Request: req, Dest: m.dir, Fallback: fallback, Unique: true}
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
		return m.fetchThumb()
	case thumbMsg:
		if m.res == nil || m.res.Data.Thumbnail == nil || *m.res.Data.Thumbnail != msg.url {
			return nil // an answer for a link that is no longer on screen
		}
		if msg.err != nil || msg.img == nil {
			m.thumb, m.thumbState = nil, thumbNone
			return nil
		}
		m.thumb, m.thumbState, m.thumbLines = msg.img, thumbReady, nil
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
		if m.picker != nil {
			cmd := m.picker.Update(msg)
			return tea.Batch(cmd, m.applyPicker())
		}
		return m.onKey(msg)
	}
	return nil
}

func (m *playground) openPicker() tea.Cmd {
	var recent []string
	if m.d.Session != nil {
		recent = m.d.Session.RecentDirs()
	}
	m.picker = newFolderPicker(m.d.FS, m.dir, m.d.DownloadDir, recent)
	return nil
}

// beginDownload starts a download, first asking where to save it unless the person turned that question off.
func (m *playground) beginDownload(req api.DownloadRequest, fallback string) tea.Cmd {
	if !m.ask {
		return m.startDownload(req, fallback)
	}
	m.pending = &pendingDL{req, fallback}
	var recent []string
	if m.d.Session != nil {
		recent = m.d.Session.RecentDirs()
	}
	m.picker = newFolderPicker(m.d.FS, m.dir, m.d.DownloadDir, recent).forDownload(m.ask)
	return nil
}

// applyPicker takes the picker's answer, if it gave one, and closes it. A chosen folder starts the download
// that was waiting for it; cancelling drops that download and leaves the results on screen.
func (m *playground) applyPicker() tea.Cmd {
	if m.picker == nil {
		return nil
	}
	if m.picker.askChange {
		m.picker.askChange = false
		m.ask = m.picker.ask
		if m.d.Session != nil {
			_ = m.d.Session.SetAskWhereToSave(m.ask)
		}
	}
	if !m.picker.done {
		return nil
	}
	chosen := m.picker.chosen
	m.picker = nil
	pending := m.pending
	m.pending = nil
	if chosen == "" {
		return nil
	}
	m.dir = chosen
	now := m.d.Now()
	if m.d.Session != nil {
		if err := m.d.Session.SetDownloadDir(chosen); err != nil {
			m.toast.set(now, "Using "+chosen+" for now, but could not remember it: "+err.Error(), true)
		}
	}
	if pending != nil {
		return m.startDownload(pending.req, pending.fallback)
	}
	m.toast.set(now, "Saving to "+m.shortDir(80), false)
	return nil
}

func (m *playground) shortDir(max int) string {
	home, _ := m.d.FS.Home()
	return fsnav.Short(m.dir, home, max)
}

func (m *playground) onKey(msg tea.KeyMsg) tea.Cmd {
	now := m.d.Now()
	k := msg.String()
	switch m.state {
	case pgInput:
		if k == "tab" {
			return m.openPicker()
		}
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
		case "f", "tab":
			return m.openPicker()
		case "esc", "/":
			m.state = pgInput
			m.in.Focus()
			return textinput.Blink
		case "d", "enter":
			if o := m.selectedOption(); o != nil {
				return m.beginDownload(o.Req, o.Fallback)
			}
		case "m":
			for i := range m.opts {
				if m.opts[i].MP3 {
					m.tbl.SetCursor(i)
					return m.beginDownload(m.opts[i].Req, m.opts[i].Fallback)
				}
			}
		case "o":
			if err := m.d.OpenURL(m.res.Data.SourceURL); err != nil {
				m.toast.set(now, "Could not open the page: "+err.Error(), true)
			}
		case "c":
			if o := m.selectedOption(); o != nil && o.LinkURL != "" {
				m.toast.set(now, "Link copied (if your terminal supports OSC 52).", false)
				return m.d.Copy(o.LinkURL)
			}
		default:
			m.tbl.Key(k)
		}
	}
	return nil
}

// ---- view -------------------------------------------------------------------------

// inputBox draws the link field: a filled field (a real pill in round mode) that gets lighter while it has focus.
// tall gives the roomy version used in the middle of the home screen.
func (m *playground) inputBox(width int, tall bool) string {
	focused := m.in.Focused()
	// the field's own styles must carry the fill colour, or the text would punch holes in it
	m.in.PromptStyle = ui.FieldText(ui.Title, focused)
	m.in.TextStyle = ui.FieldText(lipgloss.NewStyle().Foreground(ui.Text), focused)
	m.in.PlaceholderStyle = ui.FieldText(ui.MutedText, focused)
	m.in.Cursor.TextStyle = ui.FieldText(lipgloss.NewStyle(), focused)
	m.in.Cursor.Style = lipgloss.NewStyle().Foreground(ui.Accent).Background(ui.FieldBGFocus) // drawn reversed: an accent block

	padX := 2
	if tall {
		padX = 3
	}
	inner := width - 2 // between the two edge cells
	// The field prints: prompt, up to Width characters of the value, and the cursor. Leave slack so it can never wrap.
	room := inner - padX - 1
	if w := maxInt(8, room-lipgloss.Width(m.in.Prompt)-2); w != m.in.Width {
		m.in.Width = w
		m.in.SetCursor(m.in.Position()) // the field keeps a scroll offset from its old width: recompute it
	}
	row := ui.FieldRow(ansi.Truncate(m.in.View(), room, ""), inner, padX, focused)
	box := ui.Field(row, width, focused, tall)
	m.inputH = strings.Count(box, "\n") + 1
	return box
}

// folderLine is "Save to  ~/Downloads   [Tab Change]" and remembers where it is for clicks.
func (m *playground) folderLine(width int, shortcut string) string {
	label := ui.MutedText.Render("Save to  ")
	path := lipgloss.NewStyle().Bold(true).Render(m.shortDir(maxInt(12, width-24)))
	btn := ui.KeyPill(shortcut, "Change")
	return label + path + "  " + btn
}

func (m *playground) View() string {
	if m.picker != nil {
		return m.picker.View(m.w, m.h)
	}
	var out string
	switch m.state {
	case pgResult:
		out = m.resultScreen()
	case pgDownloading:
		out = m.centered(m.downloadLines())
	default:
		out = m.homeScreen()
	}
	return out
}

// centered places a block of lines in the middle of the view, a little above the exact centre like a search page.
func (m *playground) centered(lines []string) string {
	top := maxInt(0, (m.h-len(lines))*2/5)
	var b strings.Builder
	b.WriteString(strings.Repeat("\n", top))
	for i, l := range lines {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(lipgloss.PlaceHorizontal(m.w, lipgloss.Center, l))
	}
	return b.String()
}

// homeScreen is the resting state: the logo, one input in the middle, the save folder underneath.
func (m *playground) homeScreen() string {
	col := minInt(90, maxInt(30, m.w-6))
	var lines []string
	if m.h >= 24 && m.w >= ui.BannerWidth+4 {
		lines = append(lines, ui.Banner()...)
		lines = append(lines, "")
	}
	lines = append(lines, "") // room above the input
	inputAt := len(lines)
	lines = append(lines, strings.Split(m.inputBox(col, true), "\n")...)

	switch m.state {
	case pgResolving:
		lines = append(lines, "", m.sp.View()+" Resolving… "+ui.MutedText.Render("(extraction can take ~10 s)"))
	default:
		lines = append(lines, "", ui.MutedText.Render(ui.Truncate("YouTube, TikTok, X, Instagram, Facebook, SoundCloud and more", col)))
	}
	lines = append(lines, "")
	chipAt := len(lines)
	chip := m.folderLine(col, "tab")
	lines = append(lines, chip)
	if m.toast.visible(m.d.Now()) {
		style := ui.OK
		if m.toast.bad {
			style = ui.Danger
		}
		lines = append(lines, "", style.Render(ui.Truncate(m.toast.text, m.w-4)))
	}

	// remember where the clickable things are
	top := maxInt(0, (m.h-len(lines))*2/5)
	m.inputY = top + inputAt
	m.chipY = top + chipAt
	w := lipgloss.Width(chip)
	m.chipX0 = (m.w - w) / 2
	m.chipX1 = m.chipX0 + w
	return m.centered(lines)
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

func (m *playground) downloadLines() []string {
	name := m.dl.name
	if name == "" {
		return []string{m.sp.View() + " Preparing the file… " + ui.MutedText.Render("(esc to cancel)")}
	}
	name = ui.Truncate(name, maxInt(20, m.w-8))
	rate := ""
	if m.dl.speed.bps > 0 {
		rate = "  " + ui.Bytes(int64(m.dl.speed.bps)) + "/s"
	}
	where := ui.MutedText.Render("to " + m.shortDir(maxInt(12, m.w-10)))
	if m.dl.total > 0 {
		pct := float64(m.dl.done) / float64(m.dl.total)
		return []string{ui.Bold.Render(name), where, "", fmt.Sprintf("%s %3.0f%%", m.bar.ViewAs(pct), pct*100), ui.MutedText.Render(fmt.Sprintf("%s / %s%s", ui.Bytes(m.dl.done), ui.Bytes(m.dl.total), rate)), "", ui.MutedText.Render("esc to cancel")}
	}
	return []string{ui.Bold.Render(name), where, "", fmt.Sprintf("%s %s streamed%s", m.sp.View(), ui.Bytes(m.dl.done), rate), ui.MutedText.Render("merged on the fly, size unknown"), "", ui.MutedText.Render("esc to cancel")}
}

// Mouse: click the folder line to choose where to save, a row to select it, a button to act, the wheel to scroll.
func (m *playground) Mouse(msg tea.MouseMsg) tea.Cmd {
	if m.picker != nil {
		cmd := m.picker.Mouse(msg)
		return tea.Batch(cmd, m.applyPicker())
	}
	switch m.state {
	case pgInput:
		if !isLeftClick(msg) {
			return nil
		}
		if msg.Y == m.chipY && msg.X >= m.chipX0 && msg.X < m.chipX1 {
			return m.openPicker()
		}
		if msg.Y >= m.inputY && msg.Y < m.inputY+maxInt(1, m.inputH) {
			m.in.Focus()
			return textinput.Blink
		}
	case pgResult:
		if d := wheelDelta(msg); d != 0 {
			m.tbl.Wheel(d)
			return nil
		}
		if !isLeftClick(msg) {
			return nil
		}
		if msg.Y == m.chipY && msg.X >= m.chipX0 && msg.X < m.chipX1 {
			return m.openPicker()
		}
		if msg.Y == m.actsY {
			if k, ok := m.acts.Hit(msg.X - 1); ok {
				return m.onKey(keyMsg(k))
			}
			return nil
		}
		if row, ok := m.tbl.Click(msg.X-m.gridX, msg.Y-m.gridY); ok {
			if row == m.tbl.Cursor() {
				return m.onKey(keyMsg("d")) // a second click on the highlighted row downloads it
			}
			m.tbl.SetCursor(row)
		}
	}
	return nil
}

func newBar(width int) progress.Model {
	// one flat colour: the accent (progress bars take a plain colour string, so pick the shade for the background)
	c := "#58A6FF"
	if !lipgloss.HasDarkBackground() {
		c = "#0969DA"
	}
	return progress.New(progress.WithSolidFill(c), progress.WithWidth(width), progress.WithoutPercentage())
}
