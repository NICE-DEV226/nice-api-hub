package vault

import (
	"errors"
	"testing"
	"time"

	"github.com/zalando/go-keyring"
)

func TestRoundTripAndNotFound(t *testing.T) {
	keyring.MockInit()
	k := Keyring{}
	if _, err := k.Get("default", "api-key"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if err := k.Set("default", "api-key", "nah_live_x"); err != nil {
		t.Fatal(err)
	}
	if v, err := k.Get("default", "api-key"); err != nil || v != "nah_live_x" {
		t.Fatalf("%q %v", v, err)
	}
	// profiles and kinds are separate entries
	if _, err := k.Get("other", "api-key"); !errors.Is(err, ErrNotFound) {
		t.Fatal("profiles must not share secrets")
	}
	if _, err := k.Get("default", "admin-token"); !errors.Is(err, ErrNotFound) {
		t.Fatal("kinds must not share secrets")
	}
	if err := k.Delete("default", "api-key"); err != nil {
		t.Fatal(err)
	}
	if err := k.Delete("default", "api-key"); err != nil {
		t.Fatalf("deleting twice must be fine: %v", err)
	}
}

func TestBrokenStoreIsReportedAsUnavailable(t *testing.T) {
	keyring.MockInitWithError(errors.New("dbus: no session"))
	k := Keyring{}
	if err := k.Set("p", "k", "v"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
	if _, err := k.Get("p", "k"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
}

func TestAHungStoreCannotHangTheCLI(t *testing.T) {
	keyring.MockInit()
	k := Keyring{Timeout: 30 * time.Millisecond}
	start := time.Now()
	_, err := k.run(func() (string, error) { time.Sleep(2 * time.Second); return "", nil })
	if !errors.Is(err, ErrUnavailable) || time.Since(start) > time.Second {
		t.Fatalf("%v after %v", err, time.Since(start))
	}
}
