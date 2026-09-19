// Package onboard turns "a computer with nothing" into "a computer with its own account and key", and
// remembers the result. The commands and the terminal UI both use it so they behave identically.
package onboard

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/device"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/pow"
)

// Solver finds a proof-of-work nonce.
type Solver func(ctx context.Context, token string, bits int) (string, error)

// DefaultSolver uses every core.
func DefaultSolver(ctx context.Context, token string, bits int) (string, error) {
	return pow.Solve(ctx, token, bits, 0)
}

// Service talks to one gateway on behalf of this computer.
type Service struct {
	Client *api.Client
	Device device.Source
	Solve  Solver
}

func (s Service) solver() Solver {
	if s.Solve != nil {
		return s.Solve
	}
	return DefaultSolver
}

func (s Service) identify() (name, hash string, err error) {
	fp, err := device.Fingerprint(s.Device)
	if err != nil {
		return "", "", err
	}
	return s.Device.Name(), fp.Hash, nil
}

// Steps reported to the UI while registering.
const (
	StepChallenge = "Asking the gateway what it needs"
	StepWork      = "Proving this is a real computer"
	StepCreate    = "Creating your account"
)

// Info reads the signup policy.
func (s Service) Info(ctx context.Context) (api.SignupInfo, error) { return s.Client.SignupInfo(ctx) }

// Register creates an account for this computer. progress may be nil.
func (s Service) Register(ctx context.Context, accountName, invite string, progress func(step string)) (api.Enrollment, error) {
	say := func(step string) {
		if progress != nil {
			progress(step)
		}
	}
	name, hash, err := s.identify()
	if err != nil {
		return api.Enrollment{}, err
	}

	// A challenge can expire while the user thinks (or the work is slow): retry once with a fresh one.
	for attempt := 0; ; attempt++ {
		say(StepChallenge)
		info, err := s.Client.SignupInfo(ctx)
		if err != nil {
			return api.Enrollment{}, err
		}
		if !info.Open() {
			return api.Enrollment{}, &api.Problem{Status: 403, Code: "signups_closed", Detail: "Self-service signup is not enabled on this gateway. Ask its operator for a key, then use `nah login`."}
		}
		if info.RequiresInvite && strings.TrimSpace(invite) == "" {
			return api.Enrollment{}, &api.Problem{Status: 403, Code: "invalid_invite", Detail: "This gateway needs an invite code."}
		}

		say(StepWork)
		nonce, err := s.solver()(ctx, info.Challenge.Token, info.Challenge.Bits)
		if err != nil {
			return api.Enrollment{}, err
		}

		say(StepCreate)
		en, err := s.Client.Register(ctx, api.RegisterRequest{
			DeviceName: name, DeviceHash: hash,
			Challenge: info.Challenge.Token, Nonce: nonce,
			Name: strings.TrimSpace(accountName), InviteCode: strings.TrimSpace(invite),
		})
		if err != nil && attempt == 0 && api.IsCode(err, "invalid_pow") {
			continue
		}
		return en, err
	}
}

// Redeem adds this computer to an existing account with a link code.
func (s Service) Redeem(ctx context.Context, code string) (api.Enrollment, error) {
	name, hash, err := s.identify()
	if err != nil {
		return api.Enrollment{}, err
	}
	return s.Client.RedeemLink(ctx, code, name, hash)
}

// Recover turns a recovery key into a key for this computer. The recovery key is only used for this call.
func (s Service) Recover(ctx context.Context, recoveryKey string) (api.Enrollment, error) {
	name, hash, err := s.identify()
	if err != nil {
		return api.Enrollment{}, err
	}
	c := *s.Client
	c.APIKey = strings.TrimSpace(recoveryKey)
	return c.Recover(ctx, name, hash)
}

// Remember stores who this computer is and its key in the profile, and saves the file.
// The key goes to the credential store when there is one; the returned bool says so.
func Remember(f *config.File, path string, store config.SecretStore, profile, url string, en api.Enrollment, deviceName string) (inKeychain bool, err error) {
	p := f.Profiles[profile]
	p.URL = strings.TrimRight(url, "/")
	p.AccountID, p.AccountName, p.Plan, p.KeyID, p.Device = en.Account.ID, en.Account.Name, en.Account.Plan, en.KeyID, deviceName
	f.Profiles[profile] = p
	f.Current = profile
	inKeychain, err = f.StoreSecret(store, profile, config.KindAPIKey, en.Key)
	if err != nil {
		return inKeychain, err
	}
	return inKeychain, f.Save(path)
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// SaveRecoveryFile writes the recovery key to dir as a small text file readable only by the user, and returns
// its path. It never overwrites an existing file.
func SaveRecoveryFile(dir, accountName, gatewayURL, recoveryKey string, now time.Time) (string, error) {
	if dir == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	base := strings.Trim(unsafeName.ReplaceAllString(accountName, "-"), "-.")
	if base == "" {
		base = "account"
	}
	if len(base) > 40 {
		base = base[:40]
	}
	body := fmt.Sprintf("NICE-API'HUB recovery key\n\nGateway:  %s\nAccount:  %s\nCreated:  %s\n\nRecovery key:\n%s\n\n"+
		"Keep this file somewhere safe and private. It is the only way back into your account if you lose this computer:\n"+
		"  nah recover\n", gatewayURL, accountName, now.UTC().Format(time.RFC3339), recoveryKey)

	for i := 0; i < 100; i++ {
		name := "nah-recovery-" + base + ".txt"
		if i > 0 {
			name = fmt.Sprintf("nah-recovery-%s-%d.txt", base, i+1)
		}
		path := filepath.Join(dir, name)
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, werr := f.WriteString(body)
		if cerr := f.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			os.Remove(path)
			return "", werr
		}
		return path, nil
	}
	return "", errors.New("too many recovery files already exist in " + dir)
}
