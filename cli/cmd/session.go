package cmd

import (
	"context"
	"image"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/fsnav"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/onboard"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/preview"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/tui"
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

func (s session) SetDownloadDir(dir string) error {
	a := s.a
	p := a.file.Profiles[a.res.Profile]
	p.RememberDir(dir)
	a.file.Profiles[a.res.Profile] = p
	a.res.DownloadDir = dir
	return a.file.Save(a.cfgPath)
}

func (s session) AskWhereToSave() bool {
	return !s.a.file.Profiles[s.a.res.Profile].SaveWithoutAsking
}

func (s session) SetAskWhereToSave(ask bool) error {
	a := s.a
	p := a.file.Profiles[a.res.Profile]
	p.SaveWithoutAsking = !ask
	a.file.Profiles[a.res.Profile] = p
	return a.file.Save(a.cfgPath)
}

func (s session) SetRounded(on bool) error {
	s.a.file.Rounded = on
	return s.a.file.Save(s.a.cfgPath)
}

func (s session) RecentDirs() []string { return s.a.file.Profiles[s.a.res.Profile].RecentDirs }

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
		Thumb:       thumbFetcher(c),
		Profile:     a.res.Profile,
		HasAPI:      a.res.APIKey != "",
		HasAdmin:    a.res.AdminToken != "",
		Now:         a.env.Now,
		DownloadDir: dir,
		Refresh:     15 * time.Second,
		Session:     session{a: a, dir: dir},
		FS:          fsnav.System(),
		Copy: func(text string) tea.Cmd {
			return func() tea.Msg {
				_, _ = a.env.Clipboard.Copy(text)
				return nil
			}
		},
	}, nil
}

// thumbFetcher gets a preview image through the gateway, which fetches it for us (the CDN never sees this computer's
// address, and a slow local DNS does not matter). Only if the gateway cannot do it, for instance an older version
// without the route, does it try the image address directly.
func thumbFetcher(c *api.Client) func(context.Context, string) (image.Image, error) {
	direct := preview.NewClient()
	return func(ctx context.Context, url string) (image.Image, error) {
		if b, err := c.Thumbnail(ctx, url); err == nil {
			if img, derr := preview.Decode(b); derr == nil {
				return img, nil
			}
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return preview.Fetch(ctx, direct, url)
	}
}
