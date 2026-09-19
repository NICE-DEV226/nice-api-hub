package cmd

import (
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/onboard"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/tui"
)

// session lets the terminal UI change this computer's setup through the same code the commands use.
type session struct {
	a   *app
	dir string // download folder override from --download-dir
}

func (s session) URL() string { return s.a.res.URL }

func (s session) SetURL(url string) error {
	url = strings.TrimRight(strings.TrimSpace(url), "/")
	if _, err := api.New(url, "", ""); err != nil {
		return err
	}
	a := s.a
	a.res.URL = url
	p := a.file.Profiles[a.res.Profile]
	p.URL = url
	a.file.Profiles[a.res.Profile] = p
	a.file.Current = a.res.Profile
	return a.file.Save(a.cfgPath)
}

func (s session) Onboard() (onboard.Service, error) { return s.a.onboarder() }

func (s session) Enroll(en api.Enrollment) (bool, error) {
	a := s.a
	inK, err := onboard.Remember(a.file, a.cfgPath, a.env.Secrets, a.res.Profile, a.res.URL, en, a.env.Device.Name())
	if err != nil {
		return false, err
	}
	a.res.APIKey, a.res.AccountName = en.Key, en.Account.Name
	return inK, nil
}

func (s session) StoreSecret(kind, value string) (bool, error) {
	a := s.a
	inK, err := a.file.StoreSecret(a.env.Secrets, a.res.Profile, kind, value)
	if err != nil {
		return inK, err
	}
	if err := a.file.Save(a.cfgPath); err != nil {
		return inK, err
	}
	if kind == config.KindAdmin {
		a.res.AdminToken = value
	} else {
		a.res.APIKey = value
	}
	return inK, nil
}

func (s session) SaveRecovery(en api.Enrollment) (string, error) {
	a := s.a
	return onboard.SaveRecoveryFile(a.downloadDir(), en.Account.Name, a.res.URL, en.RecoveryKey, a.env.Now())
}

func (s session) Reload() (tui.Deps, error) { return s.a.tuiDeps(s.dir) }

// tuiDeps describes the terminal UI for the credentials currently known.
func (a *app) tuiDeps(dir string) (tui.Deps, error) {
	c, err := a.client()
	if err != nil {
		return tui.Deps{}, err
	}
	if dir == "" {
		dir = a.downloadDir()
	}
	return tui.Deps{
		Client:      c,
		Profile:     a.res.Profile,
		HasAPI:      a.res.APIKey != "",
		HasAdmin:    a.res.AdminToken != "",
		Now:         a.env.Now,
		DownloadDir: dir,
		Refresh:     15 * time.Second,
		Session:     session{a: a, dir: dir},
		Copy: func(text string) tea.Cmd {
			return func() tea.Msg {
				_, _ = a.env.Clipboard.Copy(text)
				return nil
			}
		},
	}, nil
}
