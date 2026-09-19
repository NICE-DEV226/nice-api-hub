package tui

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/table"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

type accountsMsg struct {
	accs []api.Account
	page api.Page
	err  error
}
type plansMsg struct {
	plans []api.Plan
	err   error
}
type detailMsg struct {
	seq   int
	id    string
	keys  []api.Key
	usage []api.UsageRow
	err   error
}
type actionMsg struct {
	text     string
	err      error
	reload   bool
	newKey   *api.Key
	selectID string
}

const (
	modeBrowse = iota
	modeNewAccount
	modeNewKey
	modeShowKey
	modeConfirm
)

type accountsView struct {
	d    Deps
	w, h int

	mode int
	pane int // 0 accounts, 1 keys

	accs     []api.Account
	page     api.Page
	plans    []api.Plan
	loaded   bool
	loading  bool
	err      error
	accTable table.Model
	keyTable table.Model

	keys      []api.Key
	usage     []api.UsageRow
	detailFor string
	detailSeq int
	detailErr error

	nameIn  textinput.Model
	labelIn textinput.Model
	planIdx int
	newKey  *api.Key
	confirm struct {
		prompt string
		run    func() tea.Cmd
	}
	toast flash
}

func newAccounts(d Deps) *accountsView {
	name := textinput.New()
	name.Placeholder = "Acme Corp"
	name.CharLimit = 120
	label := textinput.New()
	label.Placeholder = "prod"
	label.CharLimit = 80
	m := &accountsView{d: d, nameIn: name, labelIn: label}
	m.accTable = table.New(table.WithColumns(m.accColumns(40)), table.WithFocused(true), table.WithHeight(10))
	m.keyTable = table.New(table.WithColumns(m.keyColumns(60)), table.WithHeight(6))
	styleTable(&m.accTable, true)
	styleTable(&m.keyTable, false)
	return m
}

func styleTable(t *table.Model, focused bool) {
	s := table.DefaultStyles()
	s.Header = s.Header.Bold(true).Foreground(ui.Muted).BorderStyle(lipgloss.NormalBorder()).BorderForeground(ui.Subtle).BorderBottom(true)
	s.Cell = s.Cell.Padding(0, 1)
	if focused {
		s.Selected = lipgloss.NewStyle().Bold(true).Foreground(ui.OnAccent).Background(ui.Accent)
		t.Focus()
	} else {
		s.Selected = lipgloss.NewStyle().Foreground(ui.Text).Underline(true)
		t.Blur()
	}
	t.SetStyles(s)
}

// fitColumns lays columns out inside `inner` cells. Every cell has 1 cell of padding on each side
// (see styleTable), which the table widget does not count in a column's width.
func fitColumns(inner int, titles []string, fixed []int) []table.Column {
	used := 0
	for _, f := range fixed {
		used += f
	}
	flex := maxInt(6, inner-used-2*len(titles))
	cols := make([]table.Column, len(titles))
	for i, t := range titles {
		w := fixed[i]
		if w == 0 {
			w = flex
		}
		cols[i] = table.Column{Title: t, Width: w}
	}
	return cols
}

func (m *accountsView) accColumns(inner int) []table.Column {
	return fitColumns(inner, []string{"NAME", "PLAN", "STATUS"}, []int{0, 6, 9})
}

func (m *accountsView) keyColumns(inner int) []table.Column {
	return fitColumns(inner, []string{"LABEL", "PREFIX", "ENV", "STATE", "LAST USED"}, []int{0, 15, 4, 8, 9})
}

func (m *accountsView) Capturing() bool { return m.mode == modeNewAccount || m.mode == modeNewKey }

func (m *accountsView) Help() []key.Binding {
	b := func(k, h string) key.Binding { return key.NewBinding(key.WithKeys(k), key.WithHelp(k, h)) }
	switch m.mode {
	case modeNewAccount:
		return []key.Binding{b("enter", "create"), b("↑/↓", "plan"), b("esc", "cancel")}
	case modeNewKey:
		return []key.Binding{b("enter", "create"), b("esc", "cancel")}
	case modeShowKey:
		return []key.Binding{b("c", "copy"), b("esc", "close")}
	case modeConfirm:
		return []key.Binding{b("y", "confirm"), b("n", "cancel")}
	}
	return []key.Binding{b("n", "new account"), b("c", "new key"), b("x", "revoke key"), b("s", "suspend/activate"), b("tab", "switch pane"), b("r", "refresh")}
}

func (m *accountsView) SetSize(w, h int) {
	m.w, m.h = w, h
	leftW := maxInt(36, w*2/5)
	rightW := w - leftW - 1
	m.accTable.SetColumns(m.accColumns(leftW - 4))
	m.accTable.SetWidth(leftW - 4)
	m.accTable.SetHeight(maxInt(4, h-7))
	m.keyTable.SetColumns(m.keyColumns(rightW - 4))
	m.keyTable.SetWidth(rightW - 4)
	m.keyTable.SetHeight(maxInt(3, minInt(8, h/3)))
}

func (m *accountsView) Init() tea.Cmd { return nil }

func (m *accountsView) Activated() tea.Cmd {
	if !m.loaded && !m.loading {
		return m.reload("")
	}
	return nil
}

func (m *accountsView) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func (m *accountsView) reload(selectID string) tea.Cmd {
	m.loading = true
	c := m.d.Client
	return tea.Batch(
		func() tea.Msg {
			ctx, cancel := m.ctx()
			defer cancel()
			accs, page, err := c.Accounts(ctx, 100, 0)
			return accountsMsg{accs: accs, page: page, err: err}
		},
		func() tea.Msg {
			ctx, cancel := m.ctx()
			defer cancel()
			p, err := c.Plans(ctx)
			return plansMsg{plans: p, err: err}
		},
	)
}

func (m *accountsView) selected() *api.Account {
	i := m.accTable.Cursor()
	if i < 0 || i >= len(m.accs) {
		return nil
	}
	return &m.accs[i]
}

func (m *accountsView) selectedKey() *api.Key {
	i := m.keyTable.Cursor()
	if i < 0 || i >= len(m.keys) {
		return nil
	}
	return &m.keys[i]
}

func (m *accountsView) fetchDetail() tea.Cmd {
	acc := m.selected()
	if acc == nil {
		m.detailFor, m.keys, m.usage = "", nil, nil
		m.keyTable.SetRows(nil)
		return nil
	}
	m.detailSeq++
	seq, id := m.detailSeq, acc.ID
	m.detailFor = id
	c := m.d.Client
	return func() tea.Msg {
		ctx, cancel := m.ctx()
		defer cancel()
		keys, err := c.Keys(ctx, id)
		if err != nil {
			return detailMsg{seq: seq, id: id, err: err}
		}
		usage, err := c.AccountUsage(ctx, id, 7)
		return detailMsg{seq: seq, id: id, keys: keys, usage: usage, err: err}
	}
}

func (m *accountsView) rebuildAccountRows(keepID string) {
	rows := make([]table.Row, len(m.accs))
	cursor := 0
	for i, a := range m.accs {
		rows[i] = table.Row{ui.Truncate(a.Name, 60), a.PlanID, a.Status}
		if a.ID == keepID {
			cursor = i
		}
	}
	m.accTable.SetRows(rows)
	if len(rows) > 0 {
		m.accTable.SetCursor(cursor)
	}
}

func (m *accountsView) rebuildKeyRows() {
	now := m.d.Now()
	rows := make([]table.Row, len(m.keys))
	for i, k := range m.keys {
		rows[i] = table.Row{ui.Truncate(k.Label, 30), k.Prefix + "…", k.Environment, k.State(now), ui.AgoString(k.LastUsedAt, now)}
	}
	m.keyTable.SetRows(rows)
	if m.keyTable.Cursor() >= len(rows) {
		m.keyTable.SetCursor(maxInt(0, len(rows)-1))
	}
}

func (m *accountsView) act(fn func(ctx context.Context) (actionMsg, error)) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := m.ctx()
		defer cancel()
		msg, err := fn(ctx)
		msg.err = err
		return msg
	}
}

func (m *accountsView) Update(msg tea.Msg) tea.Cmd {
	now := m.d.Now()
	switch msg := msg.(type) {
	case accountsMsg:
		m.loading = false
		if msg.err != nil {
			m.err = msg.err
			return nil
		}
		m.err, m.loaded, m.accs, m.page = nil, true, msg.accs, msg.page
		keep := m.detailFor
		m.rebuildAccountRows(keep)
		return m.fetchDetail()
	case plansMsg:
		if msg.err == nil {
			m.plans = msg.plans
		}
	case detailMsg:
		if msg.seq != m.detailSeq { // a newer selection superseded this answer
			return nil
		}
		if msg.err != nil {
			m.detailErr = msg.err
			return nil
		}
		m.detailErr, m.keys, m.usage = nil, msg.keys, msg.usage
		m.rebuildKeyRows()
	case actionMsg:
		if msg.err != nil {
			m.toast.set(now, msg.err.Error(), true)
			return nil
		}
		m.toast.set(now, msg.text, false)
		if msg.newKey != nil {
			m.newKey, m.mode = msg.newKey, modeShowKey
		}
		if msg.reload {
			keep := m.detailFor
			if msg.selectID != "" {
				keep = msg.selectID
			}
			m.detailFor = keep
			return m.reload(keep)
		}
	case tea.KeyMsg:
		return m.onKey(msg)
	}
	return nil
}

func (m *accountsView) onKey(msg tea.KeyMsg) tea.Cmd {
	now := m.d.Now()
	k := msg.String()

	switch m.mode {
	case modeNewAccount:
		switch k {
		case "esc":
			m.mode = modeBrowse
		case "up", "down":
			if len(m.plans) > 0 {
				step := 1
				if k == "up" {
					step = -1
				}
				m.planIdx = (m.planIdx + step + len(m.plans)) % len(m.plans)
			}
		case "enter":
			name := strings.TrimSpace(m.nameIn.Value())
			if name == "" || len(m.plans) == 0 {
				m.toast.set(now, "A name is required.", true)
				return nil
			}
			plan := m.plans[m.planIdx].ID
			m.mode = modeBrowse
			return m.act(func(ctx context.Context) (actionMsg, error) {
				acc, err := m.d.Client.CreateAccount(ctx, name, plan, "")
				return actionMsg{text: "Created account " + acc.Name, reload: true, selectID: acc.ID}, err
			})
		default:
			var cmd tea.Cmd
			m.nameIn, cmd = m.nameIn.Update(msg)
			return cmd
		}
		return nil

	case modeNewKey:
		switch k {
		case "esc":
			m.mode = modeBrowse
		case "enter":
			label := strings.TrimSpace(m.labelIn.Value())
			acc := m.selected()
			if label == "" || acc == nil {
				m.toast.set(now, "A label is required.", true)
				return nil
			}
			id := acc.ID
			m.mode = modeBrowse
			return m.act(func(ctx context.Context) (actionMsg, error) {
				key, err := m.d.Client.CreateKey(ctx, id, label, "", nil)
				return actionMsg{text: "Key created", newKey: &key, reload: true}, err
			})
		default:
			var cmd tea.Cmd
			m.labelIn, cmd = m.labelIn.Update(msg)
			return cmd
		}
		return nil

	case modeShowKey:
		switch k {
		case "c":
			if m.newKey != nil {
				m.toast.set(now, "Copied to the clipboard (if your terminal supports OSC 52).", false)
				return m.d.Copy(m.newKey.Secret)
			}
		case "esc", "enter", "q":
			m.mode, m.newKey = modeBrowse, nil
		}
		return nil

	case modeConfirm:
		if k == "y" {
			m.mode = modeBrowse
			return m.confirm.run()
		}
		m.mode = modeBrowse
		return nil
	}

	// browse mode
	switch k {
	case "tab", "shift+tab":
		m.pane = 1 - m.pane
		styleTable(&m.accTable, m.pane == 0)
		styleTable(&m.keyTable, m.pane == 1)
		return nil
	case "r":
		return m.reload("")
	case "n":
		if len(m.plans) == 0 {
			m.toast.set(now, "Plans are not loaded yet.", true)
			return nil
		}
		m.mode = modeNewAccount
		m.nameIn.SetValue("")
		m.nameIn.Focus()
		return textinput.Blink
	case "c":
		if m.selected() == nil {
			return nil
		}
		m.mode = modeNewKey
		m.labelIn.SetValue("")
		m.labelIn.Focus()
		return textinput.Blink
	case "x":
		if m.pane != 1 {
			m.toast.set(now, "Select a key first (tab), then press x.", true)
			return nil
		}
		kk := m.selectedKey()
		if kk == nil || kk.RevokedAt != nil {
			return nil
		}
		id, label := kk.ID, kk.Label
		m.mode = modeConfirm
		m.confirm.prompt = fmt.Sprintf("Revoke key %q? Clients using it stop working immediately.", label)
		m.confirm.run = func() tea.Cmd {
			return m.act(func(ctx context.Context) (actionMsg, error) {
				_, err := m.d.Client.RevokeKey(ctx, id)
				return actionMsg{text: "Key revoked", reload: true}, err
			})
		}
		return nil
	case "s":
		acc := m.selected()
		if acc == nil {
			return nil
		}
		id, name, status := acc.ID, acc.Name, acc.Status
		next := "suspended"
		if status == "suspended" {
			next = "active"
		}
		run := func() tea.Cmd {
			return m.act(func(ctx context.Context) (actionMsg, error) {
				_, err := m.d.Client.UpdateAccount(ctx, id, "", "", next)
				return actionMsg{text: fmt.Sprintf("%s is now %s", name, next), reload: true}, err
			})
		}
		if next == "active" {
			return run()
		}
		m.mode = modeConfirm
		m.confirm.prompt = fmt.Sprintf("Suspend %q? Its API keys stop working immediately.", name)
		m.confirm.run = run
		return nil
	}

	// navigation: forward to the focused table
	var cmd tea.Cmd
	if m.pane == 0 {
		before := m.detailFor
		m.accTable, cmd = m.accTable.Update(msg)
		if sel := m.selected(); sel != nil && sel.ID != before {
			return tea.Batch(cmd, m.fetchDetail())
		}
	} else {
		m.keyTable, cmd = m.keyTable.Update(msg)
	}
	return cmd
}

func (m *accountsView) View() string {
	if m.err != nil {
		return ui.Panel.Render(ui.Danger.Render("✗ ") + wrap(m.err.Error(), minInt(80, m.w-6)) + "\n\n" + ui.MutedText.Render("Press r to retry. Is the admin token valid? (`nah login`)"))
	}
	if !m.loaded {
		return "Loading accounts…"
	}

	leftW := maxInt(36, m.w*2/5)
	rightW := m.w - leftW - 1
	left := panelFocus(fmt.Sprintf("Accounts (%d)", m.page.Total), m.accTable.View(), leftW, m.h-2, m.pane == 0)
	if len(m.accs) == 0 {
		left = panelFocus("Accounts (0)", ui.MutedText.Render("No accounts yet.\nPress n to create one."), leftW, m.h-2, true)
	}
	right := m.detailView(rightW)
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, " ", right)

	switch m.mode {
	case modeNewAccount:
		return overlay(m.w, m.h, m.newAccountForm())
	case modeNewKey:
		acc := m.selected()
		who := ""
		if acc != nil {
			who = " for " + acc.Name
		}
		return overlay(m.w, m.h, ui.PanelHot.Render(ui.Title.Render("New API key"+who)+"\n\n"+m.labelIn.View()+"\n\n"+ui.MutedText.Render("enter to create · esc to cancel")))
	case modeShowKey:
		return overlay(m.w, m.h, ui.PanelHot.Render(ui.Title.Render("API key created")+"\n\n  "+ui.Code.Render(m.newKey.Secret)+"\n\n"+
			ui.Danger.Render("Copy it now: it cannot be shown again.")+"\n"+ui.MutedText.Render("c copy to clipboard · esc close")))
	case modeConfirm:
		return overlay(m.w, m.h, ui.PanelHot.Render(ui.Warning.Render("Confirm")+"\n\n"+wrap(m.confirm.prompt, 52)+"\n\n"+ui.MutedText.Render("y yes · any other key cancels")))
	}
	if m.toast.visible(m.d.Now()) {
		style := ui.OK
		if m.toast.bad {
			style = ui.Danger
		}
		body += "\n" + style.Render(ui.Truncate(m.toast.text, m.w-2))
	}
	return body
}

func (m *accountsView) newAccountForm() string {
	plan := ui.MutedText.Render("(loading plans)")
	if len(m.plans) > 0 {
		p := m.plans[m.planIdx]
		daily := "unlimited/day"
		if p.DailyQuota != nil {
			daily = fmt.Sprintf("%d/day", *p.DailyQuota)
		}
		plan = ui.Bold.Render("‹ "+p.ID+" ›") + ui.MutedText.Render(fmt.Sprintf("  %.0f req/min · %s · %d keys", p.RPS*60, daily, p.MaxKeys))
	}
	return ui.PanelHot.Render(ui.Title.Render("New account") + "\n\n" + ui.MutedText.Render("Name") + "\n" + m.nameIn.View() +
		"\n\n" + ui.MutedText.Render("Plan (↑/↓)") + "\n" + plan + "\n\n" + ui.MutedText.Render("enter to create · esc to cancel"))
}

func (m *accountsView) detailView(width int) string {
	acc := m.selected()
	if acc == nil {
		return panelFocus("Details", ui.MutedText.Render("Select an account."), width, m.h-2, false)
	}
	email := ui.Deref(acc.ContactEmail, "—")
	head := ui.Bold.Render(acc.Name) + "  " + ui.Badge.Render(acc.PlanID) + "  " + ui.Dot(acc.Status)
	created := acc.CreatedAt
	if t, err := time.Parse(time.RFC3339, acc.CreatedAt); err == nil {
		created = ui.Ago(t, m.d.Now())
	}
	info := ui.KV([2]string{"id", acc.ID}, [2]string{"email", email}, [2]string{"created", created})

	keys := m.keyTable.View()
	if m.detailErr != nil {
		keys = ui.Danger.Render("✗ " + m.detailErr.Error())
	} else if len(m.keys) == 0 {
		keys = ui.MutedText.Render("No keys. Press c to create one.")
	}

	var req, errs, cached int64
	per := map[string]int64{}
	for _, r := range m.usage {
		req += r.Requests
		errs += r.Errors
		cached += r.CacheHits
		per[r.Platform] += r.Requests
	}
	usage := ui.MutedText.Render("No usage in the last 7 days.")
	if req > 0 {
		var top []string
		for _, p := range sortedKeys(per) {
			top = append(top, fmt.Sprintf("%s %d", p, per[p]))
		}
		usage = fmt.Sprintf("%d requests · %d cached · %d errors\n%s", req, cached, errs, ui.MutedText.Render(strings.Join(top, " · ")))
	}
	body := head + "\n" + info + "\n\n" + ui.Heading.Render(fmt.Sprintf("Keys (%d)", len(m.keys))) + "\n" + keys + "\n\n" + ui.Heading.Render("Last 7 days") + "\n" + usage
	return panelFocus("Details", body, width, m.h-2, m.pane == 1)
}

// panelFocus draws a titled box; both boxes of a split view get the same height so they line up.
func panelFocus(title, body string, width, height int, focused bool) string {
	style := ui.Panel
	if focused {
		style = ui.PanelHot
	}
	return style.Width(maxInt(12, width-2)).Height(maxInt(3, height-2)).Render(ui.Title.Render(title) + "\n" + body)
}

func overlay(w, h int, box string) string {
	return lipgloss.Place(w, maxInt(h, lipgloss.Height(box)), lipgloss.Center, lipgloss.Center, box)
}

var _ = errors.New
