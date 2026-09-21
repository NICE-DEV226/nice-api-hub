package tui

import (
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/fsnav"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

// folderPicker is a modal for choosing where files are saved.
//
// One rule carries the whole thing: the first row is always "Save in this folder", so a folder is entered with
// Enter and then chosen with Enter again. Everything else is a shortcut to get there faster: places (Downloads,
// drives…), recent folders, type-to-filter, typing or pasting a path (Tab completes), and creating a folder.
// Every part is clickable as well.
type folderPicker struct {
	env    fsnav.Env
	home   string
	places []fsnav.Place

	dir     string
	entries []fsnav.Entry
	hidden  bool
	filter  string
	rows    []pickRow
	g       *grid
	// zone: which part has the keyboard. The list (default), or the row of shortcuts above it.
	zone       int
	placeFocus int // highlighted shortcut while zone == zonePlaces
	placeStart int // first shortcut shown when they do not all fit
	err        error

	creating bool
	newIn    textinput.Model

	// result
	done   bool
	chosen string

	acts actionBar

	// purpose: choosing a default folder, or answering "where should this download go?"
	title     string
	saveLabel string
	canAsk    bool // show the "ask every time" switch
	ask       bool
	askChange bool // set when the switch was flipped, so the owner can save it

	// where things were drawn (body coordinates), for the mouse
	boxLeft, boxTop, boxW int
	contentLeft           int // x of the first content column
	contentTop            int // y of the first content line
	crumbY, placeY        int
	crumbs                []crumbSpan
	placeSpans            []placeSpan
	askY, askX0, askX1    int
	gridX, gridY          int
	actsX, actsY          int
}

const (
	zoneList = iota
	zonePlaces
)

type pickKind int

const (
	rowSave pickKind = iota
	rowUp
	rowFolder
)

type pickRow struct {
	kind  pickKind
	entry fsnav.Entry
}

type crumbSpan struct {
	x0, x1 int
	path   string
}

type placeSpan struct {
	x0, x1 int
	path   string
}

func newFolderPicker(env fsnav.Env, start, defaultDir string, recent []string) *folderPicker {
	home, _ := env.Home()
	in := textinput.New()
	in.Prompt = "▸ "
	in.PromptStyle = ui.Title
	in.CharLimit = 120
	in.Placeholder = "Folder name"
	p := &folderPicker{env: env, home: home, newIn: in, g: newGrid([]string{"FOLDER"}, []int{0}),
		title: "Choose a folder", saveLabel: "Save in this folder", askY: -1}
	p.places = fsnav.Places(env, defaultDir, recent)
	if start == "" || !env.IsDir(start) {
		start = home
	}
	if abs, err := filepath.Abs(start); err == nil {
		start = abs
	}
	p.open(start)
	return p
}

// forDownload turns the picker into the question asked when a download starts.
func (p *folderPicker) forDownload(ask bool) *folderPicker {
	p.title, p.saveLabel, p.canAsk, p.ask = "Where should this download go?", "Download in this folder", true, ask
	p.refilter()
	return p
}

func (p *folderPicker) saveButton() string {
	if p.canAsk {
		return "Download here"
	}
	return "Save here"
}

// ---- state ------------------------------------------------------------------------

func (p *folderPicker) open(dir string) {
	p.dir, p.filter, p.err = filepath.Clean(dir), "", nil
	p.reload()
	p.g.SetCursor(0)
}

func (p *folderPicker) reload() {
	es, err := fsnav.List(p.dir, p.hidden || strings.HasPrefix(p.filter, "."))
	p.entries, p.err = es, err
	p.refilter()
}

func (p *folderPicker) refilter() {
	p.rows = []pickRow{{kind: rowSave}}
	filtering := p.filter != "" && !fsnav.LooksLikePath(p.filter)
	if !filtering && fsnav.Parent(p.dir) != p.dir {
		p.rows = append(p.rows, pickRow{kind: rowUp})
	}
	var starts, contains []pickRow
	needle := strings.ToLower(p.filter)
	for _, e := range p.entries {
		if !filtering {
			starts = append(starts, pickRow{rowFolder, e})
			continue
		}
		n := strings.ToLower(e.Name)
		switch {
		case strings.HasPrefix(n, needle):
			starts = append(starts, pickRow{rowFolder, e})
		case strings.Contains(n, needle):
			contains = append(contains, pickRow{rowFolder, e})
		}
	}
	p.rows = append(append(p.rows, starts...), contains...)

	label := func(r pickRow) string {
		switch r.kind {
		case rowSave:
			return "●  " + p.saveLabel
		case rowUp:
			return "↑  .."
		}
		return "   " + r.entry.Name + "/"
	}
	cells := make([][]string, len(p.rows))
	for i, r := range p.rows {
		cells[i] = []string{label(r)}
	}
	p.g.SetRows(cells)
	// typing a filter puts the cursor on the first match, so Enter opens it
	if filtering && len(p.rows) > 1 {
		p.g.SetCursor(1)
	} else {
		p.g.SetCursor(0)
	}
}

func (p *folderPicker) current() pickRow {
	i := p.g.Cursor()
	if i < 0 || i >= len(p.rows) {
		return pickRow{kind: rowSave}
	}
	return p.rows[i]
}

// activate is Enter (and a second click): choose the folder, go up, or go into the highlighted one.
func (p *folderPicker) activate() {
	if fsnav.LooksLikePath(p.filter) {
		p.jump(p.filter)
		return
	}
	switch r := p.current(); r.kind {
	case rowSave:
		p.choose()
	case rowUp:
		p.open(fsnav.Parent(p.dir))
	case rowFolder:
		p.open(r.entry.Path)
	}
}

func (p *folderPicker) choose() {
	if err := fsnav.Writable(p.dir); err != nil {
		p.err = err
		return
	}
	p.done, p.chosen = true, p.dir
}

func (p *folderPicker) jump(typed string) {
	target := filepath.Clean(fsnav.Expand(strings.TrimSpace(typed), p.home))
	if !filepath.IsAbs(target) {
		target = filepath.Join(p.dir, target)
	}
	if !p.env.IsDir(target) {
		p.err = errNoFolder(target)
		return
	}
	p.open(target)
}

type errNoFolder string

func (e errNoFolder) Error() string {
	return "no such folder: " + string(e) + " (Tab completes what you type)"
}

// ---- keys -------------------------------------------------------------------------

func (p *folderPicker) Update(msg tea.Msg) tea.Cmd {
	km, ok := msg.(tea.KeyMsg)
	if !ok {
		return nil
	}
	if p.creating {
		return p.updateCreating(km)
	}
	p.err = nil
	if p.zone == zonePlaces && p.updatePlaces(km) {
		return nil
	}
	switch km.String() {
	case "esc":
		if p.filter != "" {
			p.filter = ""
			p.reload()
		} else {
			p.done, p.chosen = true, ""
		}
	case "enter":
		p.activate()
	case "right":
		if r := p.current(); r.kind == rowFolder {
			p.open(r.entry.Path)
		}
	case "left":
		p.open(fsnav.Parent(p.dir))
	case "backspace":
		if r := []rune(p.filter); len(r) > 0 {
			p.filter = string(r[:len(r)-1])
			p.reload()
		} else {
			p.open(fsnav.Parent(p.dir))
		}
	case "tab":
		return p.tab(1)
	case "shift+tab":
		return p.tab(-1)
	case "ctrl+t":
		p.toggleHidden()
	case "ctrl+a":
		p.toggleAsk()
	case "up":
		// the top of the list is the way up to the shortcuts
		if p.g.Cursor() == 0 && len(p.places) > 0 {
			p.focusPlaces()
		} else {
			p.g.Key("up")
		}
	case "down", "pgup", "pgdown", "home", "end":
		p.g.Key(km.String())
	case "+":
		if p.filter == "" {
			return p.startCreate()
		}
		p.typed(km)
	default:
		p.typed(km)
	}
	return nil
}

func (p *folderPicker) typed(km tea.KeyMsg) {
	if km.Type == tea.KeyRunes || km.Type == tea.KeySpace {
		p.filter += string(km.Runes) // a space arrives as KeySpace with the rune in Runes
		p.reload()
	}
}

func (p *folderPicker) toggleAsk() {
	if p.canAsk {
		p.ask, p.askChange = !p.ask, true
	}
}

func (p *folderPicker) toggleHidden() {
	p.hidden = !p.hidden
	p.reload()
}

// tab completes a typed path; otherwise it moves onto the shortcuts above the list.
func (p *folderPicker) tab(step int) tea.Cmd {
	if fsnav.LooksLikePath(p.filter) {
		if step > 0 {
			completed, _ := fsnav.Complete(p.filter, p.home, p.hidden)
			p.filter = completed
			p.reload()
		}
		return nil
	}
	if len(p.places) > 0 {
		p.focusPlaces()
	}
	return nil
}

// focusPlaces gives the keyboard to the row of shortcuts, starting on the one that is the current folder, if any.
func (p *folderPicker) focusPlaces() {
	p.zone = zonePlaces
	p.g.Blur()
	p.placeFocus = clampInt(p.placeFocus, 0, len(p.places)-1)
	for i, pl := range p.places {
		if filepath.Clean(pl.Path) == p.dir {
			p.placeFocus = i
			break
		}
	}
}

// focusList gives the keyboard back to the list of folders.
func (p *folderPicker) focusList() {
	p.zone = zoneList
	p.g.Focus()
}

// updatePlaces handles a key while the shortcuts have the keyboard. It reports false for keys that belong to the
// list (typing, +, Backspace…): the picker then goes back to the list and handles them as usual.
func (p *folderPicker) updatePlaces(km tea.KeyMsg) bool {
	n := len(p.places)
	if n == 0 {
		p.focusList()
		return false
	}
	switch km.String() {
	case "left", "shift+tab":
		p.placeFocus = (p.placeFocus - 1 + n) % n
	case "right", "tab":
		p.placeFocus = (p.placeFocus + 1) % n
	case "home":
		p.placeFocus = 0
	case "end":
		p.placeFocus = n - 1
	case "enter":
		p.open(p.places[p.placeFocus].Path)
		p.focusList()
	case "down", "esc":
		p.focusList()
	case "up":
		// already at the top
	default:
		p.focusList()
		return false
	}
	return true
}

func (p *folderPicker) startCreate() tea.Cmd {
	p.creating = true
	p.newIn.SetValue("")
	p.newIn.Focus()
	return textinput.Blink
}

func (p *folderPicker) updateCreating(km tea.KeyMsg) tea.Cmd {
	switch km.String() {
	case "esc":
		p.creating, p.err = false, nil
	case "enter":
		path, err := fsnav.Mkdir(p.dir, p.newIn.Value())
		if err != nil {
			p.err = err
			return nil
		}
		p.creating = false
		p.open(path)
	default:
		var cmd tea.Cmd
		p.newIn, cmd = p.newIn.Update(km)
		return cmd
	}
	return nil
}

// ---- mouse ------------------------------------------------------------------------

// Mouse handles clicks and the wheel; coordinates are relative to the body's top-left.
func (p *folderPicker) Mouse(msg tea.MouseMsg) tea.Cmd {
	if p.creating {
		return nil
	}
	if d := wheelDelta(msg); d != 0 {
		p.g.Wheel(d)
		return nil
	}
	if !isLeftClick(msg) {
		return nil
	}
	if msg.X < p.boxLeft || msg.X >= p.boxLeft+p.boxW {
		return nil
	}
	if msg.Y == p.crumbY {
		for _, c := range p.crumbs {
			if msg.X >= p.contentLeft+c.x0 && msg.X < p.contentLeft+c.x1 {
				p.open(c.path)
				return nil
			}
		}
	}
	for _, pl := range p.placeSpans {
		if msg.Y == p.placeY && msg.X >= p.contentLeft+pl.x0 && msg.X < p.contentLeft+pl.x1 {
			p.open(pl.path)
			p.focusList()
			return nil
		}
	}
	if p.askY >= 0 && msg.Y == p.askY && msg.X >= p.askX0 && msg.X < p.askX1 {
		p.toggleAsk()
		return nil
	}
	if msg.Y == p.actsY {
		if k, ok := p.acts.Hit(msg.X - p.actsX); ok {
			return p.Update(keyMsg(k))
		}
		return nil
	}
	if row, ok := p.g.Click(msg.X-p.gridX, msg.Y-p.gridY); ok {
		p.focusList()
		if row == p.g.Cursor() {
			p.err = nil
			p.activate() // a second click on the highlighted row opens it
		} else {
			p.g.SetCursor(row)
		}
	}
	return nil
}

// ---- view -------------------------------------------------------------------------

// View draws the picker as a filled card in the middle of the screen: a title, where you are, a row of shortcuts, the
// list, one line of help, and the buttons. Everything on it is on the card's own colour.
func (p *folderPicker) View(w, h int) string {
	compact := h < 28
	padX, padY := 3, 1
	if compact {
		padY = 0
	}
	boxW := minInt(84, maxInt(50, w-6))
	inner := boxW - 2 // between the two edge cells
	room := inner - 2*padX
	p.boxW = boxW

	var rows []string
	var idx = map[string]int{}
	add := func(name, s string) {
		rows = append(rows, ui.CardRow(s, inner, padX))
		if name != "" {
			idx[name] = len(rows) - 1
		}
	}
	blank := func() { rows = append(rows, ui.CardRow("", inner, 0)) }
	gap := func() {
		if !compact {
			blank()
		}
	}
	for i := 0; i < padY; i++ {
		blank()
	}

	add("", lipgloss.NewStyle().Bold(true).Foreground(ui.Text).Render(p.title))
	crumbs, spans := p.renderCrumbs(room)
	add("crumbs", crumbs)
	p.crumbs = spans
	gap()

	places, placeSpans := p.renderPlaces(room)
	add("places", places)
	p.placeSpans = placeSpans
	gap()

	// the list: whatever height is left
	fixed := 2*padY + 8 // title, crumbs, places, status, buttons, gaps, edges
	if !compact {
		fixed += 4
	}
	if p.canAsk {
		fixed++
		if !compact {
			fixed++
		}
	}
	listH := maxInt(3, minInt(h-fixed, 12))
	p.g.noHeader = true
	p.g.SetSize(room, listH)
	listTop := len(rows)
	for _, l := range strings.Split(p.g.View(), "\n") {
		add("", l)
	}
	gap()

	// one line: an error, the name being typed, the filter, or the help
	switch {
	case p.err != nil:
		add("", ui.Danger.Render(ui.OneLine("✗ "+errText(p.err), room)))
	case p.creating:
		add("", p.newIn.View())
	case p.filter != "":
		label := "Filter"
		if fsnav.LooksLikePath(p.filter) {
			label = "Go to"
		}
		add("", ui.MutedText.Render(label+"  ")+p.filter+ui.Title.Render("▏"))
	default:
		if p.zone == zonePlaces {
			add("", ui.MutedText.Render("← → choose a shortcut · enter go there · ↓ back to the list"))
		} else {
			add("", ui.MutedText.Render("↑ shortcuts · type to filter · + new folder · ctrl+t hidden"))
		}
	}

	askText := ""
	if p.canAsk && !p.creating {
		gap()
		box := "[ ]"
		if p.ask {
			box = "[x]"
		}
		askText = box + " Ask where to save every time"
		add("ask", ui.MutedText.Render(askText)+ui.MutedText.Render("  ctrl+a"))
	}
	gap()
	p.acts.fill, p.acts.under = ui.ChipBG, ui.CardBG
	add("acts", p.acts.Render(p.buttons()))
	for i := 0; i < padY; i++ {
		blank()
	}

	card := ui.Card(rows, boxW)
	bh, bw := lipgloss.Height(card), lipgloss.Width(card)
	p.boxLeft, p.boxTop = maxInt(0, (w-bw)/2), maxInt(0, (h-bh)/2)
	p.contentLeft, p.contentTop = p.boxLeft+1+padX, p.boxTop+1 // +1: the top edge row
	p.crumbY = p.contentTop + idx["crumbs"]
	p.placeY = p.contentTop + idx["places"]
	p.gridX, p.gridY = p.contentLeft, p.contentTop+listTop
	p.actsX, p.actsY = p.contentLeft, p.contentTop+idx["acts"]
	p.askY = -1
	if a, ok := idx["ask"]; ok {
		p.askY, p.askX0, p.askX1 = p.contentTop+a, p.contentLeft, p.contentLeft+lipgloss.Width(askText)
	}
	return lipgloss.Place(w, maxInt(h, bh), lipgloss.Center, lipgloss.Center, card)
}

func (p *folderPicker) buttons() []action {
	if p.creating {
		return []action{{"enter", "Create"}, {"esc", "Cancel"}}
	}
	if p.zone == zonePlaces {
		return []action{{"enter", "Go there"}, {"down", "Back to list"}}
	}
	open := "Open"
	if p.current().kind == rowSave {
		open = p.saveButton()
	}
	return []action{{"enter", open}, {"left", "Up"}, {"+", "New folder"}, {"esc", "Cancel"}}
}

// renderCrumbs draws "~ › Videos › 2026", eliding the start when it does not fit, and returns the click spans.
func (p *folderPicker) renderCrumbs(width int) (string, []crumbSpan) {
	cs := fsnav.Crumbs(p.dir, p.home)
	sep := " › "
	total := 0
	for i, c := range cs {
		total += lipgloss.Width(c.Label)
		if i > 0 {
			total += lipgloss.Width(sep)
		}
	}
	prefix := ""
	for total > width-4 && len(cs) > 1 {
		total -= lipgloss.Width(cs[0].Label) + lipgloss.Width(sep)
		cs = cs[1:]
		prefix = "… › "
	}
	var b strings.Builder
	var spans []crumbSpan
	x := 0
	if prefix != "" {
		b.WriteString(ui.MutedText.Render(prefix))
		x = lipgloss.Width(prefix)
	}
	for i, c := range cs {
		if i > 0 {
			b.WriteString(ui.MutedText.Render(sep))
			x += lipgloss.Width(sep)
		}
		w := lipgloss.Width(c.Label)
		style := ui.MutedText
		if i == len(cs)-1 {
			style = lipgloss.NewStyle().Foreground(ui.Accent).Bold(true)
		}
		b.WriteString(style.Render(c.Label))
		spans = append(spans, crumbSpan{x, x + w, c.Path})
		x += w
	}
	return b.String(), spans
}

// chip draws one shortcut: filled with the accent while it has the keyboard, bold accent text when it is the folder
// you are in, plain otherwise.
func (p *folderPicker) chip(i int) string {
	pl := p.places[i]
	switch {
	case p.zone == zonePlaces && i == p.placeFocus:
		return ui.PillBoldOn(pl.Label, ui.Accent, ui.OnAccent, ui.CardBG)
	case filepath.Clean(pl.Path) == p.dir:
		return ui.PillBoldOn(pl.Label, ui.ChipBG, ui.Accent, ui.CardBG)
	}
	return ui.PillOn(pl.Label, ui.ChipBG, ui.Text, ui.CardBG)
}

// renderPlaces draws the shortcuts on ONE line. When they do not all fit, the row scrolls to keep the highlighted one in
// view, with ‹ and › showing that there are more. It records where each one is for the mouse.
func (p *folderPicker) renderPlaces(width int) (string, []placeSpan) {
	n := len(p.places)
	if n == 0 {
		return "", nil
	}
	chips := make([]string, n)
	ws := make([]int, n)
	total := n - 1
	for i := range chips {
		chips[i] = p.chip(i)
		ws[i] = lipgloss.Width(chips[i])
		total += ws[i]
	}
	avail := width
	if total > width {
		avail = width - 4 // room for the two markers
	}
	// the chip to keep in view: the highlighted one, else the folder you are in
	focus := -1
	if p.zone == zonePlaces {
		focus = p.placeFocus
	} else {
		for i, pl := range p.places {
			if filepath.Clean(pl.Path) == p.dir {
				focus = i
				break
			}
		}
	}
	if total <= width {
		p.placeStart = 0
	} else {
		p.placeStart = clampInt(p.placeStart, 0, n-1)
		if focus >= 0 {
			if focus < p.placeStart {
				p.placeStart = focus
			}
			span := func(a, b int) int { // width of chips a..b with the gaps between
				w := b - a
				for i := a; i <= b; i++ {
					w += ws[i]
				}
				return w
			}
			for p.placeStart < focus && span(p.placeStart, focus) > avail {
				p.placeStart++
			}
		}
	}

	limit := width
	if total > width {
		limit = width - 2 // keep two cells for the trailing " ›"
	}
	pad := lipgloss.NewStyle().Background(ui.CardBG)
	var b strings.Builder
	var spans []placeSpan
	x := 0
	if p.placeStart > 0 {
		b.WriteString(ui.MutedText.Render("‹ "))
		x = 2
	}
	end := p.placeStart
	for i := p.placeStart; i < n; i++ {
		gap := 0
		if i > p.placeStart {
			gap = 1
		}
		if x+gap+ws[i] > limit {
			break
		}
		if gap > 0 {
			b.WriteString(pad.Render(" "))
			x++
		}
		spans = append(spans, placeSpan{x0: x, x1: x + ws[i], path: p.places[i].Path})
		b.WriteString(chips[i])
		x += ws[i]
		end = i + 1
	}
	if end < n {
		b.WriteString(ui.MutedText.Render(" ›"))
	}
	return b.String(), spans
}
