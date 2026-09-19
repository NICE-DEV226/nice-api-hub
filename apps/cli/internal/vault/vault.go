// Package vault keeps secrets in the operating system's credential store: Keychain on macOS,
// Credential Manager on Windows, the Secret Service (GNOME Keyring, KWallet) on Linux.
//
// Headless machines (servers, containers, CI) have none of these; callers then fall back to the private
// config file, so every method may fail with ErrUnavailable and that is a normal outcome.
package vault

import (
	"errors"
	"fmt"
	"time"

	"github.com/zalando/go-keyring"
)

const service = "nice-api-hub"

var (
	// ErrNotFound means the credential store works and holds no such secret.
	ErrNotFound = errors.New("secret not found")
	// ErrUnavailable means there is no usable credential store (or it did not answer in time).
	ErrUnavailable = errors.New("no credential store available")
)

// Keyring is the real credential store.
type Keyring struct {
	// Timeout bounds every call: a locked Linux keyring can wait forever for a prompt nobody sees.
	Timeout time.Duration
}

func user(profile, kind string) string { return profile + "/" + kind }

func (k Keyring) timeout() time.Duration {
	if k.Timeout > 0 {
		return k.Timeout
	}
	return 4 * time.Second
}

type result struct {
	val string
	err error
}

func (k Keyring) run(fn func() (string, error)) (string, error) {
	ch := make(chan result, 1)
	go func() {
		v, err := fn()
		ch <- result{v, err}
	}()
	select {
	case r := <-ch:
		switch {
		case r.err == nil:
			return r.val, nil
		case errors.Is(r.err, keyring.ErrNotFound):
			return "", ErrNotFound
		default:
			return "", fmt.Errorf("%w: %v", ErrUnavailable, r.err)
		}
	case <-time.After(k.timeout()):
		return "", fmt.Errorf("%w: timed out", ErrUnavailable)
	}
}

// Get returns the secret for profile/kind.
func (k Keyring) Get(profile, kind string) (string, error) {
	return k.run(func() (string, error) { return keyring.Get(service, user(profile, kind)) })
}

// Set stores the secret for profile/kind.
func (k Keyring) Set(profile, kind, value string) error {
	_, err := k.run(func() (string, error) { return "", keyring.Set(service, user(profile, kind), value) })
	return err
}

// Delete removes the secret; a missing secret is not an error.
func (k Keyring) Delete(profile, kind string) error {
	_, err := k.run(func() (string, error) { return "", keyring.Delete(service, user(profile, kind)) })
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}
