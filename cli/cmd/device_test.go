package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/device"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/paths"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/pow"
)

// enrollGW fakes the device-account endpoints, including real proof-of-work verification.
type enrollGW struct {
	*httptest.Server
	mu       sync.Mutex
	mode     string
	keys     map[string]bool // live keys
	keySeq   int
	lastAuth string
	codes    map[string]bool
}

func newEnrollGW(t *testing.T, mode string) *enrollGW {
	g := &enrollGW{mode: mode, keys: map[string]bool{}, codes: map[string]bool{"K7QM-2XPD": true}}
	send := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(v)
	}
	prob := func(w http.ResponseWriter, status int, code, detail string) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"status": status, "code": code, "detail": detail})
	}
	newKey := func() string { g.keySeq++; return "nah_live_k" + string(rune('a'+g.keySeq)) }
	mux := http.NewServeMux()
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) { send(w, 200, map[string]any{"status": "ready"}) })
	mux.HandleFunc("GET /v1/register", func(w http.ResponseWriter, r *http.Request) {
		var ch any
		if g.mode != "closed" {
			ch = map[string]any{"token": "tok", "bits": 8, "expiresAt": "2099-01-01T00:00:00Z"}
		}
		send(w, 200, map[string]any{"data": map[string]any{"mode": g.mode, "requiresInvite": false, "oneAccountPerDevice": true, "plan": nil, "challenge": ch}})
	})
	mux.HandleFunc("POST /v1/register", func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		defer g.mu.Unlock()
		var b map[string]string
		json.NewDecoder(r.Body).Decode(&b)
		if !pow.Check(b["challenge"], b["nonce"], 8) {
			prob(w, 400, "invalid_pow", "bad work")
			return
		}
		k := newKey()
		g.keys[k] = true
		send(w, 201, map[string]any{"data": map[string]any{"account": map[string]string{"id": "acc-1", "name": b["name"], "plan": "free"}, "key": k, "keyId": "11111111-1111-4111-8111-111111111111", "recoveryKey": "nah_live_RECOVERY"}})
	})
	mux.HandleFunc("POST /v1/link/redeem", func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		defer g.mu.Unlock()
		var b map[string]string
		json.NewDecoder(r.Body).Decode(&b)
		if !g.codes[b["code"]] {
			prob(w, 400, "invalid_link_code", "That link code is invalid, expired or already used.")
			return
		}
		delete(g.codes, b["code"])
		send(w, 201, map[string]any{"data": map[string]any{"account": map[string]string{"id": "acc-1", "name": "Ada", "plan": "free"}, "key": newKey(), "keyId": "22222222-2222-4222-8222-222222222222"}})
	})
	mux.HandleFunc("POST /v1/link", func(w http.ResponseWriter, r *http.Request) {
		g.lastAuth = r.Header.Get("Authorization")
		send(w, 200, map[string]any{"data": map[string]any{"code": "ABCD-EFGH", "ttlSeconds": 600, "expiresAt": "2099-01-01T00:00:00Z"}})
	})
	mux.HandleFunc("POST /v1/recover", func(w http.ResponseWriter, r *http.Request) {
		g.lastAuth = r.Header.Get("Authorization")
		send(w, 201, map[string]any{"data": map[string]any{"account": map[string]string{"id": "acc-1", "name": "Ada", "plan": "free"}, "key": newKey(), "keyId": "33333333-3333-4333-8333-333333333333"}})
	})
	keysList := []map[string]any{
		{"id": "11111111-1111-4111-8111-111111111111", "label": "box (linux)", "prefix": "nah_live_ka", "scopes": []string{"media", "keys"}, "createdVia": "register", "current": true},
		{"id": "11111111-aaaa-4111-8111-111111111111", "label": "phone", "prefix": "nah_live_zz", "scopes": []string{"media"}, "createdVia": "link", "current": false},
	}
	mux.HandleFunc("GET /v1/keys", func(w http.ResponseWriter, r *http.Request) { send(w, 200, map[string]any{"data": keysList}) })
	mux.HandleFunc("POST /v1/keys/{id}/revoke", func(w http.ResponseWriter, r *http.Request) {
		send(w, 200, map[string]any{"data": map[string]any{"id": r.PathValue("id")}})
	})
	g.Server = httptest.NewServer(mux)
	t.Cleanup(g.Close)
	return g
}

// memSecrets is an in-memory credential store.
type memSecrets struct {
	mu   sync.Mutex
	m    map[string]string
	fail bool
}

func (s *memSecrets) Get(p, k string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[p+"/"+k]
	if !ok {
		return "", os.ErrNotExist
	}
	return v, nil
}
func (s *memSecrets) Set(p, k, v string) error {
	if s.fail {
		return errors.New("no keychain")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[p+"/"+k] = v
	return nil
}
func (s *memSecrets) Delete(p, k string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, p+"/"+k)
	return nil
}

type dev struct {
	dir     string
	cfg     string
	secrets *memSecrets
	prompt  *fakePrompt
}

// runDev runs nah as a brand-new computer; state (config, keychain) carries over between calls on the same dev.
func runDev(t *testing.T, g *enrollGW, d *dev, interactive bool, args ...string) result {
	t.Helper()
	var out, errb bytes.Buffer
	env := Env{
		Out: &out, Err: &errb, In: strings.NewReader(""),
		Getenv:      func(string) string { return "" },
		ConfigPath:  d.cfg,
		Prompt:      d.prompt,
		Interactive: interactive,
		Now:         func() time.Time { return time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC) },
		Version:     "test",
		Secrets:     d.secrets,
		Device: device.Source{GOOS: "linux", DataDir: d.dir, Hostname: func() (string, error) { return "ada-laptop", nil },
			ReadFile: func(p string) ([]byte, error) {
				if p == "/etc/machine-id" {
					return []byte("3f9c1d2e8b7a4c6d9e0f1a2b3c4d5e6f"), nil
				}
				return os.ReadFile(p)
			},
			Run: func(string, ...string) ([]byte, error) { return nil, errors.New("none") }},
		Paths: pathsFor(d.dir),
	}
	root := NewRoot(env)
	root.SetArgs(append([]string{"--url", g.URL}, args...))
	err := root.ExecuteContext(context.Background())
	jsonMode := false
	for _, a := range args {
		if a == "--json" {
			jsonMode = true
		}
	}
	code := RenderError(env, err, jsonMode)
	return result{out.String(), errb.String(), code}
}

func newDev(t *testing.T) *dev {
	dir := t.TempDir()
	return &dev{dir: dir, cfg: filepath.Join(dir, "cfg", "config.json"), secrets: &memSecrets{m: map[string]string{}}, prompt: &fakePrompt{}}
}

func TestRegisterCreatesAnAccountAndKeepsTheKeyInTheKeychain(t *testing.T) {
	g := newEnrollGW(t, "open")
	d := newDev(t)
	rec := filepath.Join(d.dir, "recovery")
	r := runDev(t, g, d, false, "register", "--name", "Ada", "--save-recovery", rec)
	if r.code != 0 || !strings.Contains(r.out, "nah_live_RECOVERY") || !strings.Contains(r.out, "shown only once") {
		t.Fatalf("%d\nout=%s\nerr=%s", r.code, r.out, r.err)
	}
	if d.secrets.m["default/api-key"] != "nah_live_kb" {
		t.Fatalf("key must be in the keychain: %v", d.secrets.m)
	}
	raw, _ := os.ReadFile(d.cfg)
	if strings.Contains(string(raw), "nah_live_k") || strings.Contains(string(raw), "RECOVERY") {
		t.Fatalf("no secret may be written to the config file:\n%s", raw)
	}
	files, _ := os.ReadDir(rec)
	if len(files) != 1 {
		t.Fatalf("recovery file not written: %v", files)
	}
	// second run: already set up, and the stored key works for later commands
	if r2 := runDev(t, g, d, false, "register"); r2.code != ExitUsage || !strings.Contains(r2.err, "already set up for Ada") {
		t.Fatalf("%d %s", r2.code, r2.err)
	}
	if r3 := runDev(t, g, d, false, "link"); r3.code != 0 || !strings.Contains(r3.out, "ABCD-EFGH") || g.lastAuth != "Bearer nah_live_kb" {
		t.Fatalf("stored key must authenticate later commands: %d %s auth=%q", r3.code, r3.out+r3.err, g.lastAuth)
	}
}

func TestRegisterFallsBackToTheFileWithoutAKeychain(t *testing.T) {
	g := newEnrollGW(t, "open")
	d := newDev(t)
	d.secrets.fail = true
	if r := runDev(t, g, d, false, "register", "--name", "Ada"); r.code != 0 || !strings.Contains(r.err, "private file") {
		t.Fatalf("%d %s", r.code, r.out+r.err)
	}
	cfg, _ := config.Load(d.cfg)
	if cfg.Profiles["default"].APIKey != "nah_live_kb" {
		t.Fatalf("%+v", cfg.Profiles["default"])
	}
	if r := runDev(t, g, d, false, "account"); strings.Contains(r.err, "not configured") {
		t.Fatalf("the file-stored key must be picked up: %s", r.err)
	}
}

func TestRegisterOnAClosedGatewayPointsToTheOperator(t *testing.T) {
	g := newEnrollGW(t, "closed")
	r := runDev(t, g, newDev(t), false, "register")
	if r.code == 0 || !strings.Contains(r.err, "signups_closed") || !strings.Contains(r.err, "operator") {
		t.Fatalf("%d %s", r.code, r.err)
	}
}

func TestInteractiveRegisterOffersToSaveTheRecoveryKey(t *testing.T) {
	g := newEnrollGW(t, "open")
	d := newDev(t)
	d.prompt.confirm = true
	t.Setenv("NAH_DOWNLOAD_DIR", filepath.Join(d.dir, "dl"))
	d.dir = t.TempDir()
	r := runDev(t, g, d, true, "register", "--name", "Ada")
	if r.code != 0 || !strings.Contains(r.out, "saved to") || len(d.prompt.asked) != 1 {
		t.Fatalf("%d\n%s\n%v", r.code, r.out+r.err, d.prompt.asked)
	}
}

func TestLinkRedeemsACodeOnANewComputer(t *testing.T) {
	g := newEnrollGW(t, "open")
	d := newDev(t)
	r := runDev(t, g, d, false, "link", "K7QM-2XPD")
	if r.code != 0 || !strings.Contains(r.out, "now uses account Ada") {
		t.Fatalf("%d %s", r.code, r.out+r.err)
	}
	if r := runDev(t, g, newDev(t), false, "link", "K7QM-2XPD"); r.code == 0 || !strings.Contains(r.err, "invalid_link_code") {
		t.Fatalf("a used code must be refused: %s", r.err)
	}
}

func TestRecoverReadsTheKeyFromStdinAndStoresANewOne(t *testing.T) {
	g := newEnrollGW(t, "open")
	d := newDev(t)
	d.prompt.lines = []string{"nah_live_RECOVERY"}
	r := runDev(t, g, d, false, "recover", "--stdin")
	if r.code != 0 || g.lastAuth != "Bearer nah_live_RECOVERY" || !strings.Contains(r.out, "welcome back, Ada") {
		t.Fatalf("%d %s auth=%q", r.code, r.out+r.err, g.lastAuth)
	}
	for k, v := range d.secrets.m {
		if strings.Contains(v, "RECOVERY") {
			t.Fatalf("the recovery key must never be stored (%s)", k)
		}
	}
	if r := runDev(t, g, newDev(t), false, "recover"); r.code != ExitUsage {
		t.Fatalf("non-interactive recover without --stdin is a usage error: %d", r.code)
	}
}

func TestKeysListMarksThisComputerAndRevokeAcceptsAnIDPrefix(t *testing.T) {
	g := newEnrollGW(t, "open")
	d := newDev(t)
	runDev(t, g, d, false, "register", "--name", "Ada")
	r := runDev(t, g, d, false, "keys", "list")
	if r.code != 0 || !strings.Contains(r.out, "box (linux) (this computer)") || !strings.Contains(r.out, "phone") {
		t.Fatalf("%d %s", r.code, r.out+r.err)
	}
	if r := runDev(t, g, d, false, "keys", "revoke", "1111"); r.code != ExitUsage || !strings.Contains(r.err, "matches 2 keys") {
		t.Fatalf("ambiguous prefix: %d %s", r.code, r.err)
	}
	if r := runDev(t, g, d, false, "keys", "revoke", "zzzz"); r.code != ExitUsage {
		t.Fatalf("unknown: %d %s", r.code, r.err)
	}
	if r := runDev(t, g, d, false, "keys", "revoke", "11111111-a"); r.code != ExitUsage || !strings.Contains(r.err, "--yes") {
		t.Fatalf("needs confirmation when not interactive: %d %s", r.code, r.err)
	}
	if r := runDev(t, g, d, false, "keys", "revoke", "11111111-a", "--yes"); r.code != 0 || !strings.Contains(r.out, "revoked phone") {
		t.Fatalf("%d %s", r.code, r.out+r.err)
	}
	if d.secrets.m["default/api-key"] == "" {
		t.Fatal("revoking ANOTHER computer must keep this one's key")
	}
	if r := runDev(t, g, d, false, "keys", "revoke", "11111111-1", "--yes"); r.code != ExitUsage {
		// prefix 11111111-1 matches only the current key
		if r.code != 0 {
			t.Fatalf("%d %s", r.code, r.err)
		}
	}
	if d.secrets.m["default/api-key"] != "" {
		t.Fatal("revoking this computer's own key must forget it locally")
	}
}

func pathsFor(dir string) paths.Env {
	e := paths.System()
	e.Getenv = func(k string) string {
		if k == "NAH_DOWNLOAD_DIR" {
			return os.Getenv(k)
		}
		return ""
	}
	e.Home = func() (string, error) { return dir, nil }
	return e
}
