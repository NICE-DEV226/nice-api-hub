package tui

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/onboard"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

type setupState int

const (
	stCheck setupState = iota
	stURL
	stMenu
	stName
	stInvite
	stWork
	stRecovery
	stCode
	stRecoverKey
	stAPIKey
	stAdmin
)

type (
	checkedMsg struct {
		info *api.SignupInfo
		err  error
	}
	stepMsg     struct{ text string }
	enrolledMsg struct {
		en         api.Enrollment
		err        error
		recovery   bool // show the recovery key next
		inKeychain bool
	}
	securedMsg struct {
		err error
	}
)

type menuItem struct {
	key   string
	title string
	sub   string
}

// setupView is the first-run experience: get this computer an account, or connect an existing one.
type setupView struct {
	d     Deps
	w, h  int
	state setupState

	url  textinput.Model
	in   textinput.Model
	sp   spinner.Model
	info *api.SignupInfo
	err  error

	items  []menuItem
	cursor int

	name, invite string
	lastInput    setupState // the input screen to go back to when a step fails
	step         string
	ch           chan tea.Msg
	cancel       context.CancelFunc

	en          api.Enrollment
	savedPath   string
	copied      bool
	warnedNoKey bool
	inKeychain  bool

	acts actionBar

	// drawn positions (relative to the body), for the mouse
	boxLeft, boxTop, boxW int
	itemsY                []int // y of every menu item
	actsY, actsX          int
}

func newSetup(d Deps) *setupView {
	url := textinput.New()
	url.Prompt = "▸ "
	url.PromptStyle = ui.Title
	url.CharLimit = 300
	url.SetValue(d.Session.URL())
	in := textinput.New()
	in.Prompt = "▸ "
	in.PromptStyle = ui.Title
	in.CharLimit = 300
	return &setupView{
		d: d, url: url, in: in, state: stCheck,
		sp: spinner.New(spinner.WithSpinner(spinner.MiniDot), spinner.WithStyle(ui.Title)),
	}
}

func (m *setupView) SetSize(w, h int) { m.w, m.h = w, h }

func (m *setupView) Capturing() bool {
	switch m.state {
	case stURL, stName, stInvite, stCode, stRecoverKey, stAPIKey, stAdmin, stRecovery, stWork:
		return true
	}
	return false
}

func (m *setupView) Activated() tea.Cmd { return nil }

func (m *setupView) Init() tea.Cmd { return m.check() }

func (m *setupView) Close() {
	if m.cancel != nil {
		m.cancel()
	}
}

func (m *setupView) Help() []key.Binding {
	b := func(k, h string) key.Binding { return key.NewBinding(key.WithKeys(k), key.WithHelp(k, h)) }
	switch m.state {
	case stMenu:
		return []key.Binding{b("↑/↓", "choose"), b("enter", "select")}
	case stRecovery:
		return []key.Binding{b("c", "copy"), b("s", "save to file"), b("enter", "continue")}
	case stWork, stCheck:
		return []key.Binding{b("esc", "cancel")}
	}
	return []key.Binding{b("enter", "continue"), b("esc", "back")}
}

// ---- steps ------------------------------------------------------------------------

func (m *setupView) check() tea.Cmd {
	m.state, m.err, m.info = stCheck, nil, nil
	c := m.d.Client
	sess := m.d.Session
	return tea.Batch(m.sp.Tick, func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		probe := *c
		probe.BaseURL = strings.TrimRight(sess.URL(), "/")
		if _, err := probe.Ready(ctx); err != nil {
			return checkedMsg{err: err}
		}
		info, err := probe.SignupInfo(ctx)
		if err != nil {
			return checkedMsg{err: err}
		}
		return checkedMsg{info: &info}
	})
}

func (m *setupView) buildMenu() {
	m.items = nil
	if m.info != nil && m.info.Open() {
		m.items = append(m.items, menuItem{"create", "Create my account", "No e-mail, no password. Takes a second."})
	}
	m.items = append(m.items,
		menuItem{"code", "Add this computer to my account", "Use a link code made on another computer (nah link)."},
		menuItem{"recover", "I lost my computer: use my recovery key", "Get back into your account with the key you saved."},
		menuItem{"apikey", "I already have an API key", "Paste a key given by the operator."},
		menuItem{"admin", "I run this gateway (operator)", "Paste the admin token to manage accounts."},
		menuItem{"url", "Change the gateway address", m.d.Session.URL()},
	)
	if m.cursor >= len(m.items) {
		m.cursor = 0
	}
}

// run executes fn in the background, streaming progress steps, and feeds its result back as a message.
func (m *setupView) run(step string, fn func(ctx context.Context, say func(string)) tea.Msg) tea.Cmd {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	m.cancel = cancel
	m.state, m.err, m.step = stWork, nil, step
	ch := make(chan tea.Msg, 16)
	m.ch = ch
	go func() {
		defer cancel()
		ch <- fn(ctx, func(s string) {
			select {
			case ch <- stepMsg{s}:
			default:
			}
		})
	}()
	return tea.Batch(m.sp.Tick, waitMsg(ch))
}

func waitMsg(ch <-chan tea.Msg) tea.Cmd { return func() tea.Msg { return <-ch } }

func (m *setupView) enroll(how string, get func(ctx context.Context, svc onboard.Service, say func(string)) (api.Enrollment, error)) tea.Cmd {
	sess := m.d.Session
	return m.run("Working…", func(ctx context.Context, say func(string)) tea.Msg {
		svc, err := sess.Onboard()
		if err != nil {
			return enrolledMsg{err: err}
		}
		en, err := get(ctx, svc, say)
		if err != nil {
			return enrolledMsg{err: err}
		}
		inK, err := sess.Enroll(en)
		return enrolledMsg{en: en, err: err, recovery: how == "register", inKeychain: inK}
	})
}

func (m *setupView) secure(kind, value string, verify func(ctx context.Context, c *api.Client) error) tea.Cmd {
	sess, base := m.d.Session, m.d.Client
	return m.run("Checking the key…", func(ctx context.Context, say func(string)) tea.Msg {
		c := *base
		c.BaseURL = strings.TrimRight(sess.URL(), "/")
		if kind == config.KindAdmin {
			c.AdminToken = value
		} else {
			c.APIKey = value
		}
		if err := verify(ctx, &c); err != nil {
			return securedMsg{err: err}
		}
		_, err := sess.StoreSecret(kind, value)
		return securedMsg{err: err}
	})
}

func (m *setupView) startInput(st setupState, placeholder string, secret bool) tea.Cmd {
	m.state, m.err = st, nil
	m.in.SetValue("")
	m.in.Placeholder = placeholder
	m.in.EchoMode = textinput.EchoNormal
	if secret {
		m.in.EchoMode = textinput.EchoPassword
	}
	m.in.Focus()
	return textinput.Blink
}

func (m *setupView) choose(k string) tea.Cmd {
	switch k {
	case "create":
		return m.startInput(stName, "Name for your account (optional)", false)
	case "code":
		return m.startInput(stCode, "K7QM-2XPD", false)
	case "recover":
		return m.startInput(stRecoverKey, "nah_live_…", true)
	case "apikey":
		return m.startInput(stAPIKey, "nah_live_…", true)
	case "admin":
		return m.startInput(stAdmin, "admin token", true)
	case "url":
		m.state, m.err = stURL, nil
		m.url.SetValue(m.d.Session.URL())
		m.url.Focus()
		return textinput.Blink
	}
	return nil
}

func (m *setupView) register() tea.Cmd {
	name, invite := m.name, m.invite
	return m.enroll("register", func(ctx context.Context, svc onboard.Service, say func(string)) (api.Enrollment, error) {
		return svc.Register(ctx, name, invite, say)
	})
}

// ---- update -----------------------------------------------------------------------

func (m *setupView) Update(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case checkedMsg:
		if m.state != stCheck {
			return nil
		}
		if msg.err != nil {
			m.state, m.err = stURL, msg.err
			m.url.SetValue(m.d.Session.URL())
			m.url.Focus()
			return textinput.Blink
		}
		m.info = msg.info
		m.state = stMenu
		m.buildMenu()
	case stepMsg:
		if m.state == stWork {
			m.step = msg.text
			return waitMsg(m.ch)
		}
	case enrolledMsg:
		if m.state != stWork {
			return nil
		}
		if msg.err != nil {
			m.err = msg.err
			// "this computer already has an account" is answered by another menu entry, not by retyping
			if api.IsCode(msg.err, "device_already_registered") || api.IsCode(msg.err, "signups_closed") {
				m.state = stMenu
				m.buildMenu()
				return nil
			}
			m.state = m.lastInput
			m.in.Focus()
			return textinput.Blink
		}
		if msg.recovery {
			m.en, m.inKeychain = msg.en, msg.inKeychain
			m.state, m.savedPath, m.copied, m.warnedNoKey = stRecovery, "", false, false
			return nil
		}
		return func() tea.Msg { return setupDoneMsg{} }
	case securedMsg:
		if m.state != stWork {
			return nil
		}
		if msg.err != nil {
			m.err = msg.err
			m.state = m.lastInput
			m.in.Focus()
			return textinput.Blink
		}
		return func() tea.Msg { return setupDoneMsg{} }
	case spinner.TickMsg:
		if m.state == stCheck || m.state == stWork {
			var cmd tea.Cmd
			m.sp, cmd = m.sp.Update(msg)
			return cmd
		}
	case tea.KeyMsg:
		return m.onKey(msg)
	}
	return nil
}

func (m *setupView) onKey(msg tea.KeyMsg) tea.Cmd {
	k := msg.String()
	switch m.state {
	case stCheck, stWork:
		if k == "esc" {
			if m.cancel != nil {
				m.cancel()
			}
			m.state = stMenu
			if m.info == nil {
				m.state = stURL
			}
			m.buildMenu()
		}
		return nil

	case stMenu:
		switch k {
		case "up", "k":
			m.cursor = (m.cursor - 1 + len(m.items)) % len(m.items)
		case "down", "j", "tab":
			m.cursor = (m.cursor + 1) % len(m.items)
		case "esc":
			if m.d.HasAdmin { // came here from the operator's dashboard: go back to it
				return func() tea.Msg { return setupDoneMsg{} }
			}
		case "enter":
			return m.choose(m.items[m.cursor].key)
		default:
			if len(k) == 1 && k[0] >= '1' && k[0] <= '9' {
				if i := int(k[0] - '1'); i < len(m.items) {
					m.cursor = i
					return m.choose(m.items[i].key)
				}
			}
		}
		return nil

	case stURL:
		switch k {
		case "esc":
			if m.info != nil {
				m.state = stMenu
				return nil
			}
			return nil
		case "enter":
			v := strings.TrimSpace(m.url.Value())
			if v == "" {
				return nil
			}
			if err := m.d.Session.SetURL(v); err != nil {
				m.err = err
				return nil
			}
			return m.check()
		}
		var cmd tea.Cmd
		m.url, cmd = m.url.Update(msg)
		return cmd

	case stName, stInvite, stCode, stRecoverKey, stAPIKey, stAdmin:
		return m.onInputKey(msg, k)

	case stRecovery:
		return m.onRecoveryKey(k)
	}
	return nil
}

func (m *setupView) onInputKey(msg tea.KeyMsg, k string) tea.Cmd {
	switch k {
	case "esc":
		m.state, m.err = stMenu, nil
		return nil
	case "enter":
		v := strings.TrimSpace(m.in.Value())
		switch m.state {
		case stName:
			m.name = v
			if m.info != nil && m.info.RequiresInvite {
				return m.startInput(stInvite, "invite code", true)
			}
			m.lastInput = stName
			return m.register()
		case stInvite:
			if v == "" {
				return nil
			}
			m.invite, m.lastInput = v, stInvite
			return m.register()
		case stCode:
			if v == "" {
				return nil
			}
			m.lastInput = stCode
			return m.enroll("link", func(ctx context.Context, svc onboard.Service, say func(string)) (api.Enrollment, error) {
				return svc.Redeem(ctx, v)
			})
		case stRecoverKey:
			if v == "" {
				return nil
			}
			m.lastInput = stRecoverKey
			return m.enroll("recover", func(ctx context.Context, svc onboard.Service, say func(string)) (api.Enrollment, error) {
				return svc.Recover(ctx, v)
			})
		case stAPIKey:
			if v == "" {
				return nil
			}
			m.lastInput = stAPIKey
			return m.secure(config.KindAPIKey, v, func(ctx context.Context, c *api.Client) error {
				_, err := c.Account(ctx)
				return err
			})
		case stAdmin:
			if v == "" {
				return nil
			}
			m.lastInput = stAdmin
			return m.secure(config.KindAdmin, v, func(ctx context.Context, c *api.Client) error {
				_, err := c.Plans(ctx)
				return err
			})
		}
	}
	var cmd tea.Cmd
	m.in, cmd = m.in.Update(msg)
	return cmd
}

func (m *setupView) onRecoveryKey(k string) tea.Cmd {
	switch k {
	case "c":
		m.copied = true
		return m.d.Copy(m.en.RecoveryKey)
	case "s":
		p, err := m.d.Session.SaveRecovery(m.en)
		if err != nil {
			m.err = err
			return nil
		}
		m.savedPath, m.err = p, nil
	case "enter":
		if m.copied || m.savedPath != "" || m.warnedNoKey {
			return func() tea.Msg { return setupDoneMsg{} }
		}
		m.warnedNoKey = true
	}
	return nil
}

// Mouse: click a menu entry to pick it, click a button to press its key.
func (m *setupView) Mouse(msg tea.MouseMsg) tea.Cmd {
	switch m.state {
	case stMenu:
		if d := wheelDelta(msg); d != 0 {
			m.cursor = clampInt(m.cursor+d, 0, len(m.items)-1)
			return nil
		}
		if !isLeftClick(msg) || msg.X < m.boxLeft || msg.X >= m.boxLeft+m.boxW {
			return nil
		}
		for i, y := range m.itemsY {
			if msg.Y == y || msg.Y == y+1 { // the title line and its description
				m.cursor = i
				return m.choose(m.items[i].key)
			}
		}
	default:
		if isLeftClick(msg) && msg.Y == m.actsY {
			if k, ok := m.acts.Hit(msg.X - m.actsX); ok {
				return m.onKey(keyMsg(k))
			}
		}
	}
	return nil
}

func clampInt(v, lo, hi int) int {
	if v > hi {
		v = hi
	}
	if v < lo {
		v = lo
	}
	return v
}

// ---- view -------------------------------------------------------------------------

func (m *setupView) View() string {
	// The big logo when there is room for it; otherwise the plain title, so a small terminal never breaks.
	if out, fits := m.render(true); fits {
		return out
	}
	out, _ := m.render(false)
	return out
}

func (m *setupView) render(logo bool) (string, bool) {
	m.itemsY, m.actsY = nil, -1
	w := minInt(72, maxInt(40, m.w-4))
	m.boxW = w
	inner := w - 4

	var b strings.Builder
	if logo && m.w >= ui.BannerWidth+8 {
		pad := strings.Repeat(" ", (inner-ui.BannerWidth)/2)
		for _, l := range ui.Banner() {
			b.WriteString(pad + l + "\n")
		}
		tag := ui.Tagline
		b.WriteString(strings.Repeat(" ", maxInt(0, (inner-len(tag))/2)) + ui.MutedText.Render(tag) + "\n\n")
	} else {
		b.WriteString(ui.Title.Render("Welcome to NICE-API'HUB") + "\n")
	}
	b.WriteString(ui.MutedText.Render(m.d.Session.URL()) + "\n\n")
	hasActs := false

	switch m.state {
	case stCheck:
		b.WriteString(m.sp.View() + " Checking the gateway…")

	case stURL:
		if m.err != nil {
			b.WriteString(ui.Danger.Render(wrap("✗ "+errText(m.err), inner)) + "\n\n")
		}
		b.WriteString("Where is your gateway?\n\n" + m.url.View() + "\n\n" + ui.MutedText.Render("enter to connect"))

	case stMenu:
		b.WriteString("What do you want to do?\n\n")
		lines := strings.Count(b.String(), "\n") // content line of the first entry
		for i, it := range m.items {
			m.itemsY = append(m.itemsY, lines+i*3)
			marker, style := "  ", lipgloss.NewStyle()
			if i == m.cursor {
				marker, style = ui.Title.Render("▸ "), lipgloss.NewStyle().Bold(true)
			}
			b.WriteString(marker + style.Render(itoa(i+1)+". "+it.title) + "\n")
			b.WriteString("     " + ui.MutedText.Render(ui.Truncate(it.sub, inner-5)) + "\n\n")
		}
		if m.err != nil {
			b.WriteString(ui.Danger.Render(wrap("✗ "+errText(m.err), inner)))
		}

	case stName:
		b.WriteString("Name your account\n" + ui.MutedText.Render("Leave empty to use this computer's name.") + "\n\n" + m.in.View() + "\n\n")
		b.WriteString(m.inputFooter(inner))
	case stInvite:
		b.WriteString("This gateway needs an invite code\n\n" + m.in.View() + "\n\n" + m.inputFooter(inner))
	case stCode:
		b.WriteString("Link code\n" + ui.MutedText.Render("On your other computer run `nah link`, then type the code here.") + "\n\n" + m.in.View() + "\n\n" + m.inputFooter(inner))
	case stRecoverKey:
		b.WriteString("Recovery key\n" + ui.MutedText.Render("The key you were shown when you created your account.") + "\n\n" + m.in.View() + "\n\n" + m.inputFooter(inner))
	case stAPIKey:
		b.WriteString("API key\n\n" + m.in.View() + "\n\n" + m.inputFooter(inner))
	case stAdmin:
		b.WriteString("Admin token\n" + ui.MutedText.Render("Kept in your system keychain. Never shown again.") + "\n\n" + m.in.View() + "\n\n" + m.inputFooter(inner))

	case stWork:
		b.WriteString(m.sp.View() + " " + m.step + "\n\n" + ui.MutedText.Render("esc to cancel"))

	case stRecovery:
		b.WriteString(ui.OK.Render("✓ ") + "Account " + ui.Bold.Render(m.en.Account.Name) + " created (plan " + m.en.Account.Plan + ")\n")
		if m.inKeychain {
			b.WriteString(ui.MutedText.Render("Your key is stored in the system keychain.") + "\n\n")
		} else {
			b.WriteString(ui.MutedText.Render("Your key is stored in a private file (no system keychain here).") + "\n\n")
		}
		b.WriteString(ui.Warning.Bold(true).Render("Your recovery key — shown only once") + "\n")
		b.WriteString(ui.PanelHot.Width(inner-2).Render(ui.Bold.Render(m.en.RecoveryKey)) + "\n")
		b.WriteString(ui.MutedText.Render("It is the only way back if you lose this computer.") + "\n\n")
		if m.copied {
			b.WriteString(ui.OK.Render("✓ copied to the clipboard") + "\n")
		}
		if m.savedPath != "" {
			b.WriteString(ui.OK.Render("✓ saved to ") + ui.OneLine(m.savedPath, inner-12) + "\n")
		}
		if m.warnedNoKey && !m.copied && m.savedPath == "" {
			b.WriteString(ui.Danger.Render("You have not copied or saved it. Press enter again to continue anyway.") + "\n")
		}
		if m.err != nil {
			b.WriteString(ui.Danger.Render("✗ "+ui.OneLine(m.err.Error(), inner-2)) + "\n")
		}
		b.WriteString("\n")
		hasActs = true
		b.WriteString(m.acts.Render([]action{{"c", "Copy"}, {"s", "Save to file"}, {"enter", "Continue"}}))
	}

	box := ui.PanelHot.Width(w - 2).Render(strings.TrimRight(b.String(), "\n"))
	bh, bw := lipgloss.Height(box), lipgloss.Width(box)
	m.boxLeft, m.boxTop = maxInt(0, (m.w-bw)/2), maxInt(0, (m.h-bh)/2)
	for i := range m.itemsY {
		m.itemsY[i] += m.boxTop + 1 // + the top border
	}
	if hasActs {
		m.actsY = m.boxTop + 1 + strings.Count(strings.TrimRight(b.String(), "\n"), "\n") // the buttons are the last line
		m.actsX = m.boxLeft + 2
	}
	return lipgloss.Place(m.w, maxInt(m.h, bh), lipgloss.Center, lipgloss.Center, box), bh <= m.h || !logo
}

func (m *setupView) inputFooter(inner int) string {
	s := ""
	if m.err != nil {
		s = ui.Danger.Render(wrap("✗ "+errText(m.err), inner)) + "\n"
	}
	return s + ui.MutedText.Render("enter to continue · esc to go back")
}

func errText(err error) string {
	var p *api.Problem
	if errors.As(err, &p) && p.Detail != "" {
		return p.Detail
	}
	return err.Error()
}
