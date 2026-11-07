package tui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
)

func TestDevicesViewDirect(t *testing.T) {
	g := newFakeGateway(t)
	c, _ := api.New(g.URL, "key", "admin")
	d := Deps{
		Client: c,
		Now:    time.Now,
	}

	dv := newDevicesView(d)
	dv.SetSize(120, 30)

	// Init
	cmd := dv.Init()
	msg := cmd()
	dv.Update(msg)

	if len(dv.keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(dv.keys))
	}

	v := dv.View()
	if !strings.Contains(v, "Devices & Keys (2)") || !strings.Contains(v, "laptop (this computer)") {
		t.Fatalf("unexpected view:\n%s", v)
	}

	// New key mode
	dv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("n")})
	if dv.mode != modeNewKey {
		t.Fatalf("expected modeNewKey, got %d", dv.mode)
	}

	// Type label
	for _, r := range "ci-bot" {
		dv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}

	// Submit
	cmd = dv.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil {
		actionMsg := cmd()
		dv.Update(actionMsg)
	}

	if dv.mode != modeShowKey {
		t.Fatalf("expected modeShowKey after creation, got %d", dv.mode)
	}
	showView := dv.View()
	if !strings.Contains(showView, "nah_live_NEWKEYSECRET1234567890123456") {
		t.Fatalf("expected secret in view:\n%s", showView)
	}

	// Close show key
	dv.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if dv.mode != modeBrowse {
		t.Fatalf("expected modeBrowse after Esc, got %d", dv.mode)
	}

	// Revoke confirmation
	dv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("r")})
	if dv.mode != modeConfirm {
		t.Fatalf("expected modeConfirm, got %d", dv.mode)
	}
	cmd = dv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	if cmd != nil {
		actionMsg := cmd()
		dv.Update(actionMsg)
	}
	if dv.mode != modeBrowse {
		t.Fatalf("expected modeBrowse after revoke, got %d", dv.mode)
	}
}

func TestRevokingKeysAndLocalSecret(t *testing.T) {
	g := newFakeGateway(t)
	c, _ := api.New(g.URL, "key", "admin")
	sess := &fakeSession{}
	d := Deps{Client: c, Now: time.Now, Session: sess}

	dv := newDevicesView(d)
	dv.SetSize(120, 30)
	if cmd := dv.Init(); cmd != nil {
		dv.Update(cmd())
	}
	if len(dv.keys) != 2 || !dv.keys[0].Current {
		t.Fatalf("expected the current key first, got %+v", dv.keys)
	}

	revoke := func() tea.Cmd {
		dv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("r")})
		return dv.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	}

	// Revoking another key must not touch this computer's stored secret.
	dv.Update(tea.KeyMsg{Type: tea.KeyDown})
	cmd := revoke()
	if cmd == nil {
		t.Fatal("expected a command after confirming the revoke")
	}
	if next := dv.Update(cmd()); next != nil {
		if _, ok := next().(setupDoneMsg); ok {
			t.Fatal("revoking a non-current key must not sign this computer out")
		}
	}
	if _, stored := sess.secrets["api-key"]; stored {
		t.Fatalf("non-current revoke touched the stored secret: %q", sess.secrets["api-key"])
	}

	// Revoking the current key clears the stored secret and asks the app to rebuild.
	dv.Update(tea.KeyMsg{Type: tea.KeyUp})
	cmd = revoke()
	if cmd == nil {
		t.Fatal("expected a command after confirming the revoke")
	}
	action, ok := cmd().(deviceActionMsg)
	if !ok || !action.signOut {
		t.Fatalf("expected signOut action, got %+v", action)
	}
	next := dv.Update(action)
	if next == nil {
		t.Fatal("expected a rebuild command after revoking the current key")
	}
	if _, ok := next().(setupDoneMsg); !ok {
		t.Fatalf("expected setupDoneMsg, got %T", next())
	}
	if v, stored := sess.secrets["api-key"]; !stored || v != "" {
		t.Fatalf("stored api key not cleared: stored=%v value=%q", stored, v)
	}
}
