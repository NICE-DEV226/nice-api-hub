package onboard

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/device"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/pow"
)

type fakeGateway struct {
	*httptest.Server
	mode         string
	bits         int
	challenges   atomic.Int32
	rejectFirst  atomic.Bool
	registered   atomic.Int32
	lastRegister map[string]string
	lastRecover  string
}

func newFake(t *testing.T, mode string) *fakeGateway {
	g := &fakeGateway{mode: mode, bits: 10}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/register", func(w http.ResponseWriter, r *http.Request) {
		n := g.challenges.Add(1)
		var ch any
		if g.mode != "closed" {
			ch = map[string]any{"token": "tok-" + string(rune('a'+n)), "bits": g.bits, "expiresAt": "2099-01-01T00:00:00Z"}
		}
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"mode": g.mode, "requiresInvite": g.mode == "invite", "oneAccountPerDevice": true, "plan": nil, "challenge": ch}})
	})
	mux.HandleFunc("POST /v1/register", func(w http.ResponseWriter, r *http.Request) {
		var b map[string]string
		json.NewDecoder(r.Body).Decode(&b)
		g.lastRegister = b
		if g.rejectFirst.CompareAndSwap(true, false) || !pow.Check(b["challenge"], b["nonce"], g.bits) {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(400)
			json.NewEncoder(w).Encode(map[string]any{"status": 400, "code": "invalid_pow", "detail": "rejected"})
			return
		}
		g.registered.Add(1)
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"account": map[string]string{"id": "acc-1", "name": b["name"], "plan": "free"}, "key": "nah_live_dev", "keyId": "key-1", "recoveryKey": "nah_live_recovery"}})
	})
	mux.HandleFunc("POST /v1/link/redeem", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"account": map[string]string{"id": "acc-1", "name": "Ada", "plan": "free"}, "key": "nah_live_linked", "keyId": "key-2"}})
	})
	mux.HandleFunc("POST /v1/recover", func(w http.ResponseWriter, r *http.Request) {
		g.lastRecover = r.Header.Get("Authorization")
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"account": map[string]string{"id": "acc-1", "name": "Ada", "plan": "free"}, "key": "nah_live_back", "keyId": "key-3"}})
	})
	g.Server = httptest.NewServer(mux)
	t.Cleanup(g.Close)
	return g
}

func service(t *testing.T, g *fakeGateway) Service {
	c, err := api.New(g.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	return Service{
		Client: c,
		Device: device.Source{
			GOOS: "linux", DataDir: dir, Hostname: func() (string, error) { return "ada-laptop", nil },
			ReadFile: func(p string) ([]byte, error) {
				if p == "/etc/machine-id" {
					return []byte("3f9c1d2e8b7a4c6d9e0f1a2b3c4d5e6f"), nil
				}
				return os.ReadFile(p)
			},
			Run: func(string, ...string) ([]byte, error) { return nil, errors.New("none") },
		},
	}
}

func TestRegisterSolvesTheChallengeAndSendsOnlyAHashOfTheMachine(t *testing.T) {
	g := newFake(t, "open")
	var steps []string
	en, err := service(t, g).Register(context.Background(), "Ada", "", func(s string) { steps = append(steps, s) })
	if err != nil {
		t.Fatal(err)
	}
	if en.Key != "nah_live_dev" || en.RecoveryKey == "" || en.Account.Name != "Ada" {
		t.Fatalf("%+v", en)
	}
	if g.lastRegister["deviceName"] != "ada-laptop (linux)" || len(g.lastRegister["deviceHash"]) != 64 || strings.Contains(g.lastRegister["deviceHash"], "3f9c1d2e") {
		t.Fatalf("the machine id must be hashed: %v", g.lastRegister)
	}
	if strings.Join(steps, "|") != StepChallenge+"|"+StepWork+"|"+StepCreate {
		t.Fatalf("steps: %v", steps)
	}
}

func TestRegisterRetriesOnceWithAFreshChallengeWhenTheFirstIsRejected(t *testing.T) {
	g := newFake(t, "open")
	g.rejectFirst.Store(true)
	if _, err := service(t, g).Register(context.Background(), "Ada", "", nil); err != nil {
		t.Fatal(err)
	}
	if g.challenges.Load() != 2 {
		t.Fatalf("expected a second challenge, got %d", g.challenges.Load())
	}
}

func TestRegisterGivesUpAfterOneRetry(t *testing.T) {
	g := newFake(t, "open")
	s := service(t, g)
	s.Solve = func(context.Context, string, int) (string, error) { return "wrong", nil }
	_, err := s.Register(context.Background(), "Ada", "", nil)
	if !api.IsCode(err, "invalid_pow") || g.challenges.Load() != 2 {
		t.Fatalf("%v after %d challenges", err, g.challenges.Load())
	}
}

func TestClosedAndInviteGatewaysExplainThemselvesWithoutDoingWork(t *testing.T) {
	closed := newFake(t, "closed")
	_, err := service(t, closed).Register(context.Background(), "Ada", "", nil)
	if !api.IsCode(err, "signups_closed") || closed.registered.Load() != 0 {
		t.Fatal(err)
	}
	inv := newFake(t, "invite")
	called := false
	s := service(t, inv)
	s.Solve = func(context.Context, string, int) (string, error) { called = true; return "0", nil }
	if _, err := s.Register(context.Background(), "Ada", "  ", nil); !api.IsCode(err, "invalid_invite") || called {
		t.Fatalf("no proof of work must be spent when the invite is missing: %v", err)
	}
}

func TestCancellationStopsTheWork(t *testing.T) {
	g := newFake(t, "open")
	g.bits = 60
	s := service(t, g)
	s.Solve = func(ctx context.Context, tok string, bits int) (string, error) { return pow.Solve(ctx, tok, 60, 2) }
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	if _, err := s.Register(ctx, "Ada", "", nil); err == nil {
		t.Fatal("expected cancellation")
	}
}

func TestRecoverUsesTheRecoveryKeyOnlyForThatCall(t *testing.T) {
	g := newFake(t, "open")
	s := service(t, g)
	en, err := s.Recover(context.Background(), "  nah_live_recovery\n")
	if err != nil || en.Key != "nah_live_back" || g.lastRecover != "Bearer nah_live_recovery" {
		t.Fatalf("%+v %v %q", en, err, g.lastRecover)
	}
	if s.Client.APIKey != "" {
		t.Fatal("the shared client must not keep the recovery key")
	}
}

func TestRememberKeepsTheKeyOutOfTheFileWhenAKeychainExists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	f := &config.File{Profiles: map[string]config.Profile{}}
	st := &memStore{m: map[string]string{}}
	in, err := Remember(f, path, st, "default", "https://gw.example/", api.Enrollment{Key: "nah_live_secret", KeyID: "k", Account: api.AccountBrief{ID: "a", Name: "Ada", Plan: "free"}}, "box (linux)")
	if err != nil || !in {
		t.Fatalf("%v %v", in, err)
	}
	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), "nah_live_secret") || !strings.Contains(string(raw), "Ada") || !strings.Contains(string(raw), "https://gw.example") {
		t.Fatalf("%s", raw)
	}
	if st.m["default/api-key"] != "nah_live_secret" {
		t.Fatal("key must be in the keychain")
	}
}

type memStore struct{ m map[string]string }

func (s *memStore) Get(p, k string) (string, error) { return s.m[p+"/"+k], nil }
func (s *memStore) Set(p, k, v string) error        { s.m[p+"/"+k] = v; return nil }
func (s *memStore) Delete(p, k string) error        { delete(s.m, p+"/"+k); return nil }

func TestRecoveryFileIsPrivateAndNeverOverwrites(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "docs")
	now := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	p1, err := SaveRecoveryFile(dir, "Ada's PC / ünï", "https://gw", "nah_live_rec1", now)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := SaveRecoveryFile(dir, "Ada's PC / ünï", "https://gw", "nah_live_rec2", now)
	if err != nil || p1 == p2 {
		t.Fatalf("second save must not overwrite: %q %q %v", p1, p2, err)
	}
	b1, _ := os.ReadFile(p1)
	if !strings.Contains(string(b1), "nah_live_rec1") {
		t.Fatal("the first file was clobbered")
	}
	if strings.ContainsAny(filepath.Base(p1), " /'ü") {
		t.Fatalf("file name must be portable on Windows too: %s", filepath.Base(p1))
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(p1); st.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v", st.Mode().Perm())
		}
	}
}
