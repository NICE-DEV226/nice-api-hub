package tui

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

// grid is a scrollable table that can be driven by keyboard, mouse wheel and clicks. It replaces
// bubbles/table, which has no notion of where a row is on screen and so cannot be clicked.
//
// Cells are plain text (no ANSI): the selected row is painted as a whole.
type grid struct {
	titles []string
	fixed  []int // content width per column; 0 = takes the remaining space
	cols   []int // resolved widths

	rows    [][]string
	cursor  int
	offset  int
	width   int
	height  int // total lines, including the 2 header lines
	focused bool
	// noHeader drops the title row and its rule (a plain list, like the folder picker's)
	noHeader bool
}

func newGrid(titles []string, fixed []int) *grid {
	return &grid{titles: titles, fixed: fixed, focused: true, width: 40, height: 6}
}

const gridHeaderLines = 2

func (g *grid) headerLines() int {
	if g.noHeader {
		return 0
	}
	return gridHeaderLines
}

// SetSize gives the grid its outer size; height counts the header.
func (g *grid) SetSize(w, h int) {
	g.width, g.height = maxInt(10, w), maxInt(g.headerLines()+1, h)
	used := 0
	for _, f := range g.fixed {
		used += f
	}
	flex := maxInt(6, g.width-used-2*len(g.titles)) // 1 cell of padding each side of every column
	g.cols = make([]int, len(g.titles))
	hasFlex := false
	for i := range g.titles {
		g.cols[i] = g.fixed[i]
		if g.cols[i] == 0 {
			g.cols[i], hasFlex = flex, true
		}
	}
	if !hasFlex { // nothing to stretch: the grid is as wide as its content, not as the terminal
		g.width = minInt(g.width, used+2*len(g.titles))
	}
	g.clamp()
}

func (g *grid) visible() int { return maxInt(1, g.height-g.headerLines()) }

func (g *grid) SetRows(rows [][]string) {
	g.rows = rows
	g.clamp()
}

func (g *grid) Len() int    { return len(g.rows) }
func (g *grid) Cursor() int { return g.cursor }

func (g *grid) SetCursor(i int) {
	g.cursor = i
	g.clamp()
}

func (g *grid) Focus() { g.focused = true }
func (g *grid) Blur()  { g.focused = false }

func (g *grid) clamp() {
	if g.cursor >= len(g.rows) {
		g.cursor = len(g.rows) - 1
	}
	if g.cursor < 0 {
		g.cursor = 0
	}
	if v := g.visible(); g.cursor < g.offset {
		g.offset = g.cursor
	} else if g.cursor >= g.offset+v {
		g.offset = g.cursor - v + 1
	}
	if max := len(g.rows) - g.visible(); g.offset > max {
		g.offset = maxInt(0, max)
	}
	if g.offset < 0 {
		g.offset = 0
	}
}

// Key handles navigation keys and reports whether it did something.
func (g *grid) Key(k string) bool {
	switch k {
	case "up", "k":
		g.cursor--
	case "down", "j":
		g.cursor++
	case "pgup":
		g.cursor -= g.visible()
	case "pgdown":
		g.cursor += g.visible()
	case "home", "g":
		g.cursor = 0
	case "end", "G":
		g.cursor = len(g.rows) - 1
	default:
		return false
	}
	g.clamp()
	return true
}

// Wheel scrolls the selection by n rows (negative = up).
func (g *grid) Wheel(n int) {
	g.cursor += n
	g.clamp()
}

// Click returns the row under (x, y) given in the grid's own coordinates (0,0 = top-left of its header).
func (g *grid) Click(x, y int) (int, bool) {
	if x < 0 || x >= g.width || y < g.headerLines() {
		return 0, false
	}
	row := g.offset + y - g.headerLines()
	if row < 0 || row >= len(g.rows) || y-g.headerLines() >= g.visible() {
		return 0, false
	}
	return row, true
}

func (g *grid) cell(s string, w int) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\t", " ")
	if lipgloss.Width(s) > w {
		s = ansi.Truncate(s, w, "…")
	}
	return " " + s + strings.Repeat(" ", w-lipgloss.Width(s)) + " "
}

func (g *grid) line(cells []string) string {
	var b strings.Builder
	for i := range g.cols {
		c := ""
		if i < len(cells) {
			c = cells[i]
		}
		b.WriteString(g.cell(c, g.cols[i]))
	}
	return b.String()
}

func (g *grid) View() string {
	if g.cols == nil {
		g.SetSize(g.width, g.height)
	}
	lines := make([]string, 0, g.height)
	if !g.noHeader {
		lines = append(lines, ui.MutedText.Bold(true).Render(g.line(g.titles)))
		lines = append(lines, lipgloss.NewStyle().Foreground(ui.Subtle).Render(strings.Repeat("─", g.width)))
	}

	selected := lipgloss.NewStyle().Bold(true).Foreground(ui.OnAccent).Background(ui.Accent)
	dim := lipgloss.NewStyle().Bold(true).Background(ui.ChipBG) // the selection while another part has the keyboard: a soft fill
	for i := 0; i < g.visible(); i++ {
		idx := g.offset + i
		if idx >= len(g.rows) {
			break
		}
		l := g.line(g.rows[idx])
		switch {
		case idx == g.cursor && g.focused:
			l = selected.Render(l)
		case idx == g.cursor:
			l = dim.Render(l)
		}
		lines = append(lines, l)
	}
	return strings.Join(lines, "\n")
}

// ---- clickable actions ---------------------------------------------------------------

// action is a keyboard shortcut that can also be clicked.
type action struct {
	key   string // what a press of the button does, as a tea.KeyMsg string ("d", "enter", "esc"…)
	label string
}

// actionBar renders a row of buttons and maps a click back to the action under the pointer.
type actionBar struct {
	spans [][2]int // [start, end) columns of each button
	items []action
	// on: the surface the buttons sit on (a card's fill). Zero value = the plain terminal.
	fill, under lipgloss.TerminalColor
}

// Render draws the buttons on one line and remembers where each one is.
func (b *actionBar) Render(items []action) string {
	b.items = items
	b.spans = b.spans[:0]
	var sb strings.Builder
	x := 0
	for i, it := range items {
		if i > 0 {
			sb.WriteString(" ")
			x++
		}
		txt := ui.KeyPill(it.key, it.label)
		if b.fill != nil {
			txt = ui.KeyPillOn(it.key, it.label, b.fill, b.under)
		}
		w := lipgloss.Width(txt)
		b.spans = append(b.spans, [2]int{x, x + w})
		sb.WriteString(txt)
		x += w
	}
	return sb.String()
}

// Hit returns the key of the button at column x (relative to where Render's output starts).
func (b *actionBar) Hit(x int) (string, bool) {
	for i, s := range b.spans {
		if x >= s[0] && x < s[1] {
			return b.items[i].key, true
		}
	}
	return "", false
}

// keyMsg builds the tea.KeyMsg a button press stands for.
func keyMsg(k string) tea.KeyMsg {
	switch k {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "tab":
		return tea.KeyMsg{Type: tea.KeyTab}
	case "up":
		return tea.KeyMsg{Type: tea.KeyUp}
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}
	case "left":
		return tea.KeyMsg{Type: tea.KeyLeft}
	case "right":
		return tea.KeyMsg{Type: tea.KeyRight}
	case "backspace":
		return tea.KeyMsg{Type: tea.KeyBackspace}
	case "ctrl+t":
		return tea.KeyMsg{Type: tea.KeyCtrlT}
	case "ctrl+a":
		return tea.KeyMsg{Type: tea.KeyCtrlA}
	}
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
}

// isLeftClick reports a left-button press (not a release or drag).
func isLeftClick(m tea.MouseMsg) bool {
	return m.Action == tea.MouseActionPress && m.Button == tea.MouseButtonLeft
}

// wheelDelta returns -1/+1 for a wheel step up/down, else 0.
func wheelDelta(m tea.MouseMsg) int {
	if m.Action != tea.MouseActionPress {
		return 0
	}
	switch m.Button {
	case tea.MouseButtonWheelUp:
		return -1
	case tea.MouseButtonWheelDown:
		return 1
	}
	return 0
}
