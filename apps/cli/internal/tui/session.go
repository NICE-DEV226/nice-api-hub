package tui

import (
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/onboard"
)

// Session is what the interface may change about this computer's setup: who it is on the gateway and where the
// credentials are kept. The command line implements it on top of the config file and the system keychain.
type Session interface {
	URL() string
	// SetURL points the app at another gateway and remembers it.
	SetURL(url string) error
	// Onboard returns the service that creates accounts on the current gateway.
	Onboard() (onboard.Service, error)
	// Enroll remembers the account and key this computer just received; the bool says whether the key went to the keychain.
	Enroll(en api.Enrollment) (inKeychain bool, err error)
	// StoreSecret saves an API key ("api-key") or an operator token ("admin-token"); "" removes it.
	StoreSecret(kind, value string) (inKeychain bool, err error)
	// SaveRecovery writes the recovery key to a private file and returns its path.
	SaveRecovery(en api.Enrollment) (string, error)
	// SetDownloadDir makes dir the default download folder, remembers it, and saves the setting.
	SetDownloadDir(dir string) error
	// AskWhereToSave reports whether starting a download opens the folder picker first (the default).
	AskWhereToSave() bool
	// SetAskWhereToSave turns that question on or off and saves the setting.
	SetAskWhereToSave(ask bool) error
	// SetRounded remembers whether pills are drawn with rounded ends (Ctrl+R).
	SetRounded(on bool) error
	// RecentDirs lists the folders chosen before, most recent first.
	RecentDirs() []string
	// Reload rebuilds the dependencies from the saved setup (new client, new capabilities).
	Reload() (Deps, error)
}

// setupDoneMsg tells the app the setup changed: rebuild the tabs from the saved credentials.
type setupDoneMsg struct{}
