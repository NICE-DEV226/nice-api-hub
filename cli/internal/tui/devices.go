package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

type devicesLoadedMsg struct {
	keys []api.Key
	err  error
}

type deviceActionMsg struct {
	text   string
	err    error
	newKey *api.Key
	reload bool
}

type devicesView struct {
	d       Deps
	w, h    int
	mode    int
	loaded  bool
	loading bool
	err     error

	keys  []api.Key
	table *grid

	labelIn textinput.Model
	newKey  *api.Key
	confirm struct {
		prompt string
		run    func() tea.Cmd
	}

	toast flash
	leftW int
}

func newDevicesView(d Deps) *devicesView {
	li := textinput.New()
	li.Placeholder = "my-laptop / backup-script"
	li.CharLimit = 80

	v := &devicesView{
		d:       d,
		labelIn: li,
	}
	v.table = newGrid([]string{"LABEL", "PREFIX", "SCOPES", "VIA", "STATE", "LAST USED"}, []int{0, 15, 12, 8, 8, 10})
	return v
}

func (v *devicesView) Init() tea.Cmd {
	return v.reload()
}

func (v *devicesView) Activated() tea.Cmd {
	return v.reload()
}

func (v *devicesView) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 20*time.Second)
}

func (v *devicesView) reload() tea.Cmd {
	v.loading = true
	c := v.d.Client
	return func() tea.Msg {
		if c == nil {
			return devicesLoadedMsg{keys: nil, err: nil}
		}
		ctx, cancel := v.ctx()
		defer cancel()
		keys, err := c.MyKeys(ctx)
		return devicesLoadedMsg{keys: keys, err: err}
	}
}

func (v *devicesView) selected() *api.Key {
	i := v.table.Cursor()
	if i < 0 || i >= len(v.keys) {
		return nil
	}
	return &v.keys[i]
}

func (v *devicesView) rebuildRows(keepID string) {
	now := v.d.Now()
	rows := make([][]string, len(v.keys))
	cursor := 0
	for i, k := range v.keys {
		label := k.Label
		if k.Current {
			label += " (this computer)"
		}
		scopes := strings.Join(k.Scopes, ",")
		if scopes == "" {
			scopes = "media"
		}
		via := k.CreatedVia
		if via == "" {
			via = "device"
		}
		rows[i] = []string{
			ui.Truncate(label, 30),
			k.Prefix + "…",
			scopes,
			via,
			k.State(now),
			ui.AgoString(k.LastUsedAt, now),
		}
		if k.ID == keepID {
			cursor = i
		}
	}
	v.table.SetRows(rows)
	if len(rows) > 0 {
		v.table.SetCursor(cursor)
	}
}

func (v *devicesView) SetSize(w, h int) {
	v.w, v.h = w, h
	leftW := maxInt(38, w*3/5)
	v.leftW = leftW
	v.table.SetSize(leftW-2, maxInt(4, h-4))
}

func (v *devicesView) Capturing() bool {
	return v.mode == modeNewKey
}

func (v *devicesView) Help() []key.Binding {
	return []key.Binding{
		key.NewBinding(key.WithKeys("n", "c"), key.WithHelp("n", "new key")),
		key.NewBinding(key.WithKeys("r"), key.WithHelp("r", "revoke key")),
		key.NewBinding(key.WithKeys("R"), key.WithHelp("R", "rotate key")),
		key.NewBinding(key.WithKeys("y"), key.WithHelp("y", "copy key ID")),
	}
}

func (v *devicesView) act(fn func(ctx context.Context) (deviceActionMsg, error)) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := v.ctx()
		defer cancel()
		msg, err := fn(ctx)
		msg.err = err
		return msg
	}
}

func (v *devicesView) Update(msg tea.Msg) tea.Cmd {
	now := v.d.Now()
	switch msg := msg.(type) {
	case devicesLoadedMsg:
		v.loading = false
		if msg.err != nil {
			v.err = msg.err
			return nil
		}
		v.err, v.loaded, v.keys = nil, true, msg.keys
		keep := ""
		if sel := v.selected(); sel != nil {
			keep = sel.ID
		}
		v.rebuildRows(keep)
		return nil

	case deviceActionMsg:
		if msg.err != nil {
			v.toast.set(now, msg.err.Error(), true)
			return nil
		}
		v.toast.set(now, msg.text, false)
		if msg.newKey != nil {
			v.newKey, v.mode = msg.newKey, modeShowKey
		}
		if msg.reload {
			return v.reload()
		}

	case tea.KeyMsg:
		return v.onKey(msg)
	}
	return nil
}

func (v *devicesView) onKey(msg tea.KeyMsg) tea.Cmd {
	now := v.d.Now()
	k := msg.String()

	switch v.mode {
	case modeNewKey:
		switch k {
		case "esc":
			v.mode = modeBrowse
			return nil
		case "enter":
			label := strings.TrimSpace(v.labelIn.Value())
			if label == "" {
				v.toast.set(now, "A label is required.", true)
				return nil
			}
			v.mode = modeBrowse
			return v.act(func(ctx context.Context) (deviceActionMsg, error) {
				key, err := v.d.Client.CreateMyKey(ctx, label, []string{"media"})
				return deviceActionMsg{text: "Created key " + key.Label, newKey: &key, reload: true}, err
			})
		default:
			var cmd tea.Cmd
			v.labelIn, cmd = v.labelIn.Update(msg)
			return cmd
		}

	case modeShowKey:
		switch k {
		case "c":
			if v.newKey != nil {
				v.toast.set(now, "Copied secret key to clipboard.", false)
				if v.d.Copy != nil {
					return v.d.Copy(v.newKey.Secret)
				}
			}
		case "esc", "enter":
			v.mode = modeBrowse
			v.newKey = nil
		}
		return nil

	case modeConfirm:
		switch k {
		case "y", "Y":
			run := v.confirm.run
			v.mode = modeBrowse
			v.confirm.run = nil
			if run != nil {
				return run()
			}
		default:
			v.mode = modeBrowse
			v.confirm.run = nil
		}
		return nil
	}

	switch k {
	case "n":
		v.mode = modeNewKey
		v.labelIn.SetValue("")
		v.labelIn.Focus()
		return textinput.Blink

	case "r":
		sel := v.selected()
		if sel == nil {
			return nil
		}
		id, label := sel.ID, sel.Label
		warn := ""
		if sel.Current {
			warn = " — WARNING: This is THIS computer's current key!"
		}
		v.mode = modeConfirm
		v.confirm.prompt = fmt.Sprintf("Revoke key %q%s? Devices using it stop working immediately.", label, warn)
		v.confirm.run = func() tea.Cmd {
			return v.act(func(ctx context.Context) (deviceActionMsg, error) {
				_, err := v.d.Client.RevokeMyKey(ctx, id)
				return deviceActionMsg{text: "Revoked key " + label, reload: true}, err
			})
		}
		return nil

	case "R":
		sel := v.selected()
		if sel == nil {
			return nil
		}
		id, label := sel.ID, sel.Label
		v.mode = modeConfirm
		v.confirm.prompt = fmt.Sprintf("Rotate key %q? A new secret will be created; old key lives for 1h.", label)
		v.confirm.run = func() tea.Cmd {
			return v.act(func(ctx context.Context) (deviceActionMsg, error) {
				key, err := v.d.Client.RotateMyKey(ctx, id, 3600)
				return deviceActionMsg{text: "Rotated key " + label, newKey: &key, reload: true}, err
			})
		}
		return nil

	case "y":
		sel := v.selected()
		if sel == nil {
			return nil
		}
		v.toast.set(now, "Copied key ID to clipboard: "+sel.ID, false)
		if v.d.Copy != nil {
			return v.d.Copy(sel.ID)
		}
		return nil
	}

	v.table.Key(k)
	return nil
}

func (v *devicesView) Mouse(msg tea.MouseMsg) tea.Cmd {
	if v.mode != modeBrowse || !v.loaded {
		return nil
	}
	if d := wheelDelta(msg); d != 0 {
		v.table.Wheel(d)
		return nil
	}
	if !isLeftClick(msg) {
		return nil
	}
	if row, ok := v.table.Click(msg.X-2, msg.Y-2); ok {
		v.table.SetCursor(row)
	}
	return nil
}

func (v *devicesView) View() string {
	if v.err != nil {
		return ui.Panel.Render(ui.Danger.Render("✗ ") + wrap(v.err.Error(), minInt(80, v.w-6)) + "\n\n" + ui.MutedText.Render("Press r to retry."))
	}
	if !v.loaded {
		return "Loading devices & keys…"
	}

	leftW := maxInt(38, v.w*3/5)
	v.leftW = leftW
	rightW := v.w - leftW - 1

	headerTitle := fmt.Sprintf("Devices & Keys (%d)", len(v.keys))
	leftContent := v.table.View()
	if len(v.keys) == 0 {
		leftContent = ui.MutedText.Render("No keys found for this account.\nPress n to create one.")
	}

	left := panelFocus(headerTitle, leftContent, leftW, v.h-2, true)
	right := v.detailView(rightW)
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, " ", right)

	switch v.mode {
	case modeNewKey:
		return overlay(v.w, v.h, ui.PanelHot.Render(ui.Title.Render("New Device / API Key")+"\n\n"+
			v.labelIn.View()+"\n\n"+
			ui.MutedText.Render("enter to create · esc to cancel")))
	case modeShowKey:
		secret := ""
		if v.newKey != nil {
			secret = v.newKey.Secret
		}
		return overlay(v.w, v.h, ui.PanelHot.Render(ui.Title.Render("Key Created")+"\n\n  "+
			ui.Code.Render(secret)+"\n\n"+
			ui.Danger.Render("Copy it now: it cannot be shown again.")+"\n"+
			ui.MutedText.Render("c copy to clipboard · esc close")))
	case modeConfirm:
		return overlay(v.w, v.h, ui.PanelHot.Render(ui.Warning.Render("Confirm")+"\n\n"+
			wrap(v.confirm.prompt, 52)+"\n\n"+
			ui.MutedText.Render("y yes · any other key cancels")))
	}

	if v.toast.visible(v.d.Now()) {
		style := ui.OK
		if v.toast.bad {
			style = ui.Danger
		}
		body += "\n" + style.Render(ui.Truncate(v.toast.text, v.w-2))
	}
	return body
}

func (v *devicesView) detailView(w int) string {
	sel := v.selected()
	if sel == nil {
		return panelFocus("Details", ui.MutedText.Render("Select a key to view details.\nPress n to create a new key."), w, v.h-2, false)
	}

	now := v.d.Now()
	var sb strings.Builder
	title := sel.Label
	if sel.Current {
		title += " (this computer)"
	}
	sb.WriteString(ui.Title.Render(ui.Truncate(title, w-6)) + "\n\n")

	sb.WriteString(ui.Bold.Render("Key ID: ") + ui.MutedText.Render(sel.ID) + "\n")
	sb.WriteString(ui.Bold.Render("Prefix: ") + sel.Prefix + "…" + "\n")
	sb.WriteString(ui.Bold.Render("State:  ") + ui.Dot(sel.State(now)) + " " + sel.State(now) + "\n")
	via := sel.CreatedVia
	if via == "" {
		via = "device"
	}
	sb.WriteString(ui.Bold.Render("Via:    ") + via + "\n")
	scopes := strings.Join(sel.Scopes, ", ")
	if scopes == "" {
		scopes = "media"
	}
	sb.WriteString(ui.Bold.Render("Scopes: ") + scopes + "\n\n")

	if sel.Current {
		sb.WriteString(ui.OK.Render("★ Active credentials for this session") + "\n\n")
	}

	if sel.CreatedAt != "" {
		sb.WriteString(ui.Bold.Render("Created:   ") + sel.CreatedAt + "\n")
	}
	if sel.LastUsedAt != nil {
		sb.WriteString(ui.Bold.Render("Last used: ") + ui.AgoString(sel.LastUsedAt, now) + "\n")
	}
	if sel.ExpiresAt != nil {
		sb.WriteString(ui.Bold.Render("Expires:   ") + *sel.ExpiresAt + "\n")
	}
	if sel.RevokedAt != nil {
		sb.WriteString(ui.Danger.Render("Revoked:   ") + *sel.RevokedAt + "\n")
	}

	sb.WriteString("\n" + ui.MutedText.Render("n new key · r revoke · R rotate · y copy ID"))
	return panelFocus("Details", sb.String(), w, v.h-2, false)
}
