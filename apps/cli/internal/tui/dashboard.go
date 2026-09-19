package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

type healthMsg struct {
	ready api.Readiness
	plats []api.PlatformStatus
	err   error
}

type acctMsg struct {
	acc   api.AccountInfo
	usage api.Usage
	err   error
}

type dashboard struct {
	d       Deps
	w, h    int
	loading bool
	err     error
	ready   *api.Readiness
	plats   []api.PlatformStatus
	acc     *api.AccountInfo
	usage   *api.Usage
	acctErr error
	updated time.Time
	spin    spinner.Model
}

func newDashboard(d Deps) *dashboard {
	return &dashboard{d: d, spin: spinner.New(spinner.WithSpinner(spinner.MiniDot), spinner.WithStyle(ui.Title))}
}

func (m *dashboard) SetSize(w, h int) { m.w, m.h = w, h }
func (m *dashboard) Capturing() bool  { return false }
func (m *dashboard) Activated() tea.Cmd {
	if m.updated.IsZero() || m.d.Now().Sub(m.updated) > 5*time.Second {
		return m.refresh()
	}
	return nil
}

func (m *dashboard) Help() []key.Binding {
	return []key.Binding{key.NewBinding(key.WithKeys("r"), key.WithHelp("r", "refresh"))}
}

func (m *dashboard) Init() tea.Cmd { return tea.Batch(m.refresh(), m.spin.Tick) }

func (m *dashboard) refresh() tea.Cmd {
	m.loading = true
	cmds := []tea.Cmd{func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		rd, err := m.d.Client.Ready(ctx)
		if err != nil {
			return healthMsg{err: err}
		}
		pl, err := m.d.Client.Platforms(ctx)
		return healthMsg{ready: rd, plats: pl, err: err}
	}}
	if m.d.HasAPI {
		cmds = append(cmds, func() tea.Msg {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			acc, err := m.d.Client.Account(ctx)
			if err != nil {
				return acctMsg{err: err}
			}
			u, err := m.d.Client.Usage(ctx, 1)
			return acctMsg{acc: acc, usage: u, err: err}
		})
	}
	return tea.Batch(cmds...)
}

func (m *dashboard) Update(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case healthMsg:
		m.loading = false
		m.updated = m.d.Now()
		if msg.err != nil {
			m.err = msg.err
			return nil
		}
		m.err = nil
		m.ready, m.plats = &msg.ready, msg.plats
	case acctMsg:
		if msg.err != nil {
			m.acctErr = msg.err
			return nil
		}
		m.acctErr = nil
		m.acc, m.usage = &msg.acc, &msg.usage
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		if m.loading {
			return cmd
		}
		return cmd
	case tea.KeyMsg:
		if msg.String() == "r" {
			return m.refresh()
		}
	}
	return nil
}

func (m *dashboard) View() string {
	if m.err != nil {
		box := ui.Panel.Width(minInt(m.w-4, 90)).Render(
			ui.Danger.Render("✗ Cannot reach the gateway") + "\n\n" + wrap(m.err.Error(), minInt(m.w-8, 84)) + "\n\n" +
				ui.MutedText.Render("URL: "+m.d.Client.BaseURL+"\nIs the stack up? Try `docker compose ps`, then press r."))
		return box
	}
	if m.ready == nil {
		return m.spin.View() + " Connecting to " + m.d.Client.BaseURL + "…"
	}

	gw := m.gatewayPanel()
	pl := m.platformsPanel()
	if m.w >= 100 && m.d.HasAPI {
		leftW := (m.w - 3) * 5 / 11
		left := lipgloss.JoinVertical(lipgloss.Left, panel("Gateway", gw, leftW), panel("Platforms", pl, leftW))
		right := panel("Your account", m.accountPanel(), m.w-leftW-3)
		return lipgloss.JoinHorizontal(lipgloss.Top, left, " ", right)
	}
	parts := []string{panel("Gateway", gw, m.w-2), panel("Platforms", pl, m.w-2)}
	if m.d.HasAPI {
		parts = append(parts, panel("Your account", m.accountPanel(), m.w-2))
	}
	return lipgloss.JoinVertical(lipgloss.Left, parts...)
}

func (m *dashboard) gatewayPanel() string {
	status := ui.Dot(m.ready.Status)
	for _, n := range sortedKeys(m.ready.Checks) {
		mark := ui.OK.Render("✓")
		if !m.ready.Checks[n] {
			mark = ui.Danger.Render("✗")
		}
		status += "  " + n + " " + mark
	}
	upd := "—"
	if !m.updated.IsZero() {
		upd = ui.Ago(m.updated, m.d.Now())
	}
	if m.loading {
		upd += " " + m.spin.View()
	}
	return ui.KV([2]string{"url", m.d.Client.BaseURL}, [2]string{"status", status}, [2]string{"updated", upd})
}

func (m *dashboard) platformsPanel() string {
	if len(m.plats) == 0 {
		return ui.MutedText.Render("No platform available.")
	}
	counts := map[string]int{}
	var b strings.Builder
	for i, p := range m.plats {
		counts[p.Status]++
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(fmt.Sprintf("%-14s %s", p.Name, ui.Dot(p.Status)))
	}
	b.WriteString("\n\n" + ui.MutedText.Render(fmt.Sprintf("%d operational · %d degraded · %d down · %d unknown",
		counts["operational"], counts["degraded"], counts["down"], counts["unknown"])))
	return b.String()
}

func (m *dashboard) accountPanel() string {
	if m.acctErr != nil {
		return ui.Danger.Render("✗ ") + m.acctErr.Error()
	}
	if m.acc == nil || m.usage == nil {
		return m.spin.View() + " loading…"
	}
	today := m.d.Now().UTC().Format("2006-01-02")
	var req, cached, errs int64
	per := map[string]int64{}
	for _, r := range m.usage.Usage {
		if r.Day == today {
			req += r.Requests
			cached += r.CacheHits
			errs += r.Errors
			per[r.Platform] += r.Requests
		}
	}
	limit := "unlimited plan"
	bar := ui.MutedText.Render("no daily limit")
	if q := m.usage.Limits.DailyQuota; q != nil {
		limit = fmt.Sprintf("%d / %d today", req, *q)
		bar = ui.Bar(req, *q, 28)
	}
	lines := []string{
		ui.Bold.Render(m.acc.Name) + "  " + ui.Badge.Render(m.acc.Plan),
		ui.MutedText.Render(limitsLine(m.usage.Limits)),
		"",
		bar + " " + limit,
		"",
		ui.KV([2]string{"requests", fmt.Sprint(req)}, [2]string{"cache hits", fmt.Sprint(cached)}, [2]string{"errors", fmt.Sprint(errs)}),
	}
	if len(per) > 0 {
		lines = append(lines, "", ui.MutedText.Render("by platform"))
		for _, p := range sortedKeys(per) {
			lines = append(lines, fmt.Sprintf("  %-12s %d", p, per[p]))
		}
	}
	return strings.Join(lines, "\n")
}

func limitsLine(l api.Limits) string {
	daily := "unlimited/day"
	if l.DailyQuota != nil {
		daily = fmt.Sprintf("%d/day", *l.DailyQuota)
	}
	return fmt.Sprintf("%.0f req/min · burst %d · %s", l.RPS*60, l.Burst, daily)
}
