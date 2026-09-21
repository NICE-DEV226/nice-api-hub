package tui

import (
	"context"
	"errors"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/device"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/onboard"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/pow"
)

// fakeSession records what the setup screen asked to persist.
type fakeSession struct {
	url       string
	svc       onboard.Service
	enrolled  []api.Enrollment
	secrets   map[string]string
	saved     []api.Enrollment
	reloadDep Deps
	dirs      []string
	noAsk     bool
	rounded   bool
}

func (s *fakeSession) SetDownloadDir(dir string) error {
	s.dirs = append([]string{dir}, s.dirs...)
	return nil
}
func (s *fakeSession) AskWhereToSave() bool { return !s.noAsk }
func (s *fakeSession) SetAskWhereToSave(ask bool) error {
	s.noAsk = !ask
	return nil
}
func (s *fakeSession) SetRounded(on bool) error          { s.rounded = on; return nil }
func (s *fakeSession) RecentDirs() []string              { return s.dirs }
func (s *fakeSession) URL() string                       { return s.url }
func (s *fakeSession) SetURL(u string) error             { s.url = u; return nil }
func (s *fakeSession) Onboard() (onboard.Service, error) { return s.svc, nil }
func (s *fakeSession) Reload() (Deps, error)             { return s.reloadDep, nil }
func (s *fakeSession) SaveRecovery(en api.Enrollment) (string, error) {
	s.saved = append(s.saved, en)
	return "/home/a/Downloads/nah-recovery.txt", nil
}
func (s *fakeSession) Enroll(en api.Enrollment) (bool, error) {
	s.enrolled = append(s.enrolled, en)
	return true, nil
}
func (s *fakeSession) StoreSecret(kind, value string) (bool, error) {
	if s.secrets == nil {
		s.secrets = map[string]string{}
	}
	s.secrets[kind] = value
	return true, nil
}

func newSetupApp(t *testing.T, sess *fakeSession, g *fakeGateway) (*App, *setupView) {
	t.Helper()
	c, err := api.New(g.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	sess.url = g.URL
	c2, _ := api.New(g.URL, "", "")
	sess.svc = onboard.Service{Client: c2, Device: device.Source{GOOS: "linux", DataDir: t.TempDir(), Hostname: func() (string, error) { return "box", nil },
		ReadFile: func(p string) ([]byte, error) { return []byte("3f9c1d2e8b7a4c6d9e0f1a2b3c4d5e6f"), nil },
		Run:      func(string, ...string) ([]byte, error) { return nil, errors.New("none") }},
		Solve: func(ctx context.Context, token string, bits int) (string, error) {
			return pow.Solve(ctx, token, bits, 0)
		}}
	d := Deps{Client: c, Profile: "test", Session: sess, Copy: func(string) tea.Cmd { return nil }}
	a := NewApp(d)
	a.Update(tea.WindowSizeMsg{Width: 100, Height: 36})
	return a, a.current().(*setupView)
}

func TestAComputerWithoutCredentialsStartsOnTheWelcomeScreen(t *testing.T) {
	g := newFakeGateway(t)
	sess := &fakeSession{}
	a, sv := newSetupApp(t, sess, g)
	if !a.setupMode || sv == nil {
		t.Fatal("no credentials must open the setup screen")
	}
	if strings.Contains(a.View(), "Dashboard") {
		t.Fatal("no tabs while setting up")
	}
	// a key or an operator token means the normal tabs
	c, _ := api.New(g.URL, "k", "")
	if b := NewApp(Deps{Client: c, HasAPI: true, Session: sess}); b.setupMode {
		t.Fatal("a computer with a key must not see the welcome screen")
	}
	// and no Session (older embedding, tests) never shows it
	if b := NewApp(Deps{Client: c}); b.setupMode {
		t.Fatal("without a session there is nothing to set up")
	}
}

func TestMenuOffersCreationOnlyWhenSignupIsOpen(t *testing.T) {
	sv := &setupView{d: Deps{Session: &fakeSession{url: "http://x"}}}
	sv.info = &api.SignupInfo{Mode: "closed"}
	sv.buildMenu()
	for _, it := range sv.items {
		if it.key == "create" {
			t.Fatal("a closed gateway must not offer account creation")
		}
	}
	sv.info = &api.SignupInfo{Mode: "open", Challenge: &api.Challenge{Token: "t", Bits: 1}}
	sv.buildMenu()
	if sv.items[0].key != "create" {
		t.Fatalf("open gateway: creation first, got %v", sv.items[0].key)
	}
}

func TestPickingAMenuEntryWithTheMouse(t *testing.T) {
	g := newFakeGateway(t)
	sess := &fakeSession{}
	a, sv := newSetupApp(t, sess, g)
	sv.state = stMenu
	sv.info = &api.SignupInfo{Mode: "open", Challenge: &api.Challenge{Token: "t", Bits: 1}}
	sv.buildMenu()
	a.View()
	if len(sv.itemsY) != len(sv.items) {
		t.Fatalf("positions: %v", sv.itemsY)
	}
	// click on the description line of "I already have an API key"
	var idx int
	for i, it := range sv.items {
		if it.key == "apikey" {
			idx = i
		}
	}
	a.Update(click(sv.boxLeft+5, a.bodyTop+sv.itemsY[idx]+1))
	if sv.state != stAPIKey {
		t.Fatalf("state %d", sv.state)
	}
	// clicks outside the box do nothing
	sv.state = stMenu
	a.Update(click(0, a.bodyTop+sv.itemsY[0]))
	if sv.state != stMenu {
		t.Fatal("click outside the box must be ignored")
	}
}

func TestAPIKeyIsVerifiedThenStored(t *testing.T) {
	g := newFakeGateway(t)
	sess := &fakeSession{}
	_, sv := newSetupApp(t, sess, g)
	sv.state = stMenu
	sv.choose("apikey")
	sv.in.SetValue("nah_live_good")
	sv.lastInput = stAPIKey
	cmd := sv.onInputKey(keyMsg("enter"), "enter")
	if sv.state != stWork {
		t.Fatalf("state %d", sv.state)
	}
	var done tea.Msg
	for i := 0; i < 5 && cmd != nil; i++ {
		msg := cmd()
		if _, ok := msg.(tea.BatchMsg); ok {
			for _, c := range msg.(tea.BatchMsg) {
				if c == nil {
					continue
				}
				if r := c(); r != nil {
					if _, isSec := r.(securedMsg); isSec {
						done = r
					}
				}
			}
			break
		}
	}
	sm, ok := done.(securedMsg)
	if !ok || sm.err != nil {
		t.Fatalf("verification: %#v", done)
	}
	if sess.secrets[config.KindAPIKey] != "nah_live_good" {
		t.Fatalf("stored: %v", sess.secrets)
	}
}

func TestRecoveryScreenRequiresAConsciousChoice(t *testing.T) {
	g := newFakeGateway(t)
	sess := &fakeSession{}
	_, sv := newSetupApp(t, sess, g)
	sv.en = api.Enrollment{Account: api.AccountBrief{Name: "Ada", Plan: "free"}, RecoveryKey: "nah_live_RECOVERY"}
	sv.state = stRecovery
	if cmd := sv.onKey(keyMsg("enter")); cmd != nil {
		t.Fatal("the first enter without copying or saving must warn, not continue")
	}
	if !sv.warnedNoKey || !strings.Contains(sv.View(), "not copied or saved") {
		t.Fatal("the warning must be visible")
	}
	if cmd := sv.onKey(keyMsg("enter")); cmd == nil {
		t.Fatal("the second enter continues")
	} else if _, ok := cmd().(setupDoneMsg); !ok {
		t.Fatal("continuing finishes the setup")
	}

	sv.state, sv.warnedNoKey = stRecovery, false
	sv.onKey(keyMsg("s"))
	if len(sess.saved) != 1 || sv.savedPath == "" {
		t.Fatal("s saves the recovery key to a file")
	}
	if cmd := sv.onKey(keyMsg("enter")); cmd == nil {
		t.Fatal("after saving, one enter is enough")
	}
	if !strings.Contains(sv.View(), "nah_live_RECOVERY") {
		t.Fatal("the key must be on screen")
	}
}

func TestSetupDoneRebuildsTheTabsFromTheSavedCredentials(t *testing.T) {
	g := newFakeGateway(t)
	sess := &fakeSession{}
	a, _ := newSetupApp(t, sess, g)
	c, _ := api.New(g.URL, "nah_live_new", "")
	sess.reloadDep = Deps{Client: c, Profile: "test", HasAPI: true, Session: sess, Copy: func(string) tea.Cmd { return nil }}
	_, cmd := a.Update(setupDoneMsg{})
	if a.setupMode || len(a.tabs) != 2 {
		t.Fatalf("setup=%v tabs=%d", a.setupMode, len(a.tabs))
	}
	if a.tabs[a.active].id != tabPlayground {
		t.Fatal("after setup, land on the Playground")
	}
	if cmd == nil {
		t.Fatal("the new views must start")
	}
}
