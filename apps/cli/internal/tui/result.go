package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/preview"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

// fetchThumb starts loading the thumbnail of the media on screen, if it has one.
func (m *playground) fetchThumb() tea.Cmd {
	if m.thumbTo != nil {
		m.thumbTo()
		m.thumbTo = nil
	}
	m.thumb, m.thumbState, m.thumbLines = nil, thumbNone, nil
	if m.res == nil || m.res.Data.Thumbnail == nil || *m.res.Data.Thumbnail == "" || m.d.Thumb == nil {
		return nil
	}
	url := *m.res.Data.Thumbnail
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	m.thumbTo = cancel
	m.thumbState = thumbLoading
	fetch := m.d.Thumb
	return func() tea.Msg {
		defer cancel()
		img, err := fetch(ctx, url)
		return thumbMsg{url: url, img: img, err: err}
	}
}

// thumbBlock returns the lines of the preview, drawn inside at most cols×rows cells, or nil when there is none.
func (m *playground) thumbBlock(cols, rows int) []string {
	switch m.thumbState {
	case thumbReady:
		if m.thumbLines == nil || m.thumbKey != [2]int{cols, rows} {
			profile := lipgloss.ColorProfile()
			if profile != termenv.Ascii && profile != termenv.ANSI && profile != termenv.ANSI256 && profile != termenv.TrueColor {
				profile = termenv.TrueColor
			}
			m.thumbLines, m.thumbCols, m.thumbRows = preview.Render(m.thumb, cols, rows, profile)
			m.thumbKey = [2]int{cols, rows}
		}
		return m.thumbLines
	case thumbLoading:
		fill := lipgloss.NewStyle().Background(ui.FieldBG)
		out := make([]string, rows)
		for i := range out {
			out[i] = fill.Render(strings.Repeat(" ", cols))
		}
		msg := "loading preview…"
		out[rows/2] = fill.Foreground(ui.Muted).Render(centerIn(msg, cols))
		return out
	}
	return nil
}

func centerIn(s string, w int) string {
	n := lipgloss.Width(s)
	if n >= w {
		return s
	}
	left := (w - n) / 2
	return strings.Repeat(" ", left) + s + strings.Repeat(" ", w-n-left)
}

// clampLines keeps the first n lines of s, ending the last one with an ellipsis when something was cut.
func clampLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) <= n {
		return s
	}
	last := strings.TrimRight(lines[n-1], " ")
	return strings.Join(append(lines[:n-1], last+"…"), "\n")
}

// resultScreen is the overview of what was found: the preview image, the title and who made it, the choices for
// downloading it, and where it will be saved. With room, the image sits beside the title and the choices.
func (m *playground) resultScreen() string {
	d := m.res.Data
	width := maxInt(30, m.w-2)

	title := ui.Deref(d.Title, "(untitled)")
	dur := ""
	if d.DurationSeconds != nil {
		dur = ui.Duration(*d.DurationSeconds)
	}
	meta := joinDot(ui.Deref(d.Author, ""), dur, d.Platform)
	via := fmt.Sprintf("via %s · %d ms", d.Provider, m.res.Meta.TookMs)

	// layout: side by side when there is room and something to show
	wantThumb := m.thumbState != thumbNone
	side := wantThumb && width >= 92
	thumbCols, thumbRows := 50, 12
	if m.h >= 34 {
		thumbRows = 14 // a taller image when the window allows it: more pixels, a sharper picture
	}
	if !side {
		thumbCols, thumbRows = minInt(width, 52), 9
		if m.h < 30 {
			thumbRows = 6
		}
	}
	infoW := width
	if side {
		infoW = width - thumbCols - 3
	}

	head := clampLines(lipgloss.NewStyle().Bold(true).Width(infoW).Render(ui.OneLine(title, infoW*3)), 2)
	metaLine := ui.MutedText.Render(ui.Truncate(meta, infoW))
	viaLine := ui.MutedText.Render(ui.Truncate(via, infoW))
	if m.res.Meta.Cached {
		viaLine += " " + ui.Badge.Render("cached")
	}
	info := []string{head, metaLine, viaLine, ""}
	infoTop := len(info)

	// rows for the list: what is left of the screen, at least 3
	m.tbl.SetSize(infoW, minInt(len(m.opts)+gridHeaderLines, maxInt(gridHeaderLines+3, m.h-20)))
	info = append(info, strings.Split(m.tbl.View(), "\n")...)

	var b strings.Builder
	b.WriteString(indent(m.inputBox(maxInt(30, m.w-2), false), " "))
	b.WriteString("\n\n")
	top := strings.Count(b.String(), "\n")

	var thumb []string
	if wantThumb {
		thumb = m.thumbBlock(thumbCols, thumbRows)
	}
	switch {
	case side && len(thumb) > 0:
		left := make([]string, len(thumb))
		for i, l := range thumb {
			left[i] = centerIn2(l, thumbCols)
		}
		joined := lipgloss.JoinHorizontal(lipgloss.Top, strings.Join(left, "\n"), "   ", strings.Join(info, "\n"))
		b.WriteString(indent(joined, " "))
		m.gridY, m.gridX = top+infoTop+strings.Count(head, "\n"), 1+thumbCols+3
	case len(thumb) > 0:
		for _, l := range thumb {
			b.WriteString(" " + l + "\n")
		}
		b.WriteString("\n")
		b.WriteString(indent(strings.Join(info, "\n"), " "))
		m.gridY, m.gridX = top+len(thumb)+1+infoTop+strings.Count(head, "\n"), 1
	default:
		b.WriteString(indent(strings.Join(info, "\n"), " "))
		m.gridY, m.gridX = top+infoTop+strings.Count(head, "\n"), 1
	}

	b.WriteString("\n\n ")
	m.actsY = strings.Count(b.String(), "\n")
	b.WriteString(m.acts.Render(m.buttonsFor(width)))
	b.WriteString("\n\n ")
	m.chipY = strings.Count(b.String(), "\n")
	chip := m.folderLine(m.w, "f")
	b.WriteString(chip)
	m.chipX0, m.chipX1 = 1, 1+lipgloss.Width(chip)
	if m.toast.visible(m.d.Now()) {
		style := ui.OK
		if m.toast.bad {
			style = ui.Danger
		}
		b.WriteString("\n\n " + style.Render(ui.Truncate(m.toast.text, m.w-4)))
	}
	return b.String()
}

// centerIn2 pads an already rendered image row to cols cells (left blank margin, as the image may be narrower
// than its box, e.g. a vertical video).
func centerIn2(line string, cols int) string {
	n := lipgloss.Width(line)
	if n >= cols {
		return line
	}
	left := (cols - n) / 2
	return strings.Repeat(" ", left) + line + strings.Repeat(" ", cols-n-left)
}

// buttonsFor picks as many buttons as fit the width, dropping the least important first.
func (m *playground) buttonsFor(width int) []action {
	all := []struct {
		a        action
		priority int // higher goes first when space runs out
	}{
		{action{"d", "Download"}, 6}, {action{"m", "MP3"}, 3}, {action{"o", "Open page"}, 4},
		{action{"f", "Folder"}, 5}, {action{"c", "Copy link"}, 2}, {action{"esc", "New URL"}, 7},
	}
	keep := func(min int) []action {
		var out []action
		for _, x := range all {
			if x.priority >= min {
				out = append(out, x.a)
			}
		}
		return out
	}
	for min := 1; min <= 7; min++ {
		set := keep(min)
		total := 0
		for i, a := range set {
			total += len(a.key) + len(a.label) + 3 + 1
			if i == 0 {
				total--
			}
		}
		if total <= width {
			return set
		}
	}
	return keep(7)
}
