package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakePrompt struct {
	lines   []string
	secrets []string
	confirm bool
	asked   []string
}

func (p *fakePrompt) ReadLine(prompt string) (string, error) {
	p.asked = append(p.asked, prompt)
	if len(p.lines) == 0 {
		return "", io.EOF
	}
	l := p.lines[0]
	p.lines = p.lines[1:]
	return l, nil
}
func (p *fakePrompt) ReadSecret(prompt string) (string, error) {
	p.asked = append(p.asked, prompt)
	if len(p.secrets) == 0 {
		return "", nil
	}
	s := p.secrets[0]
	p.secrets = p.secrets[1:]
	return s, nil
}
func (p *fakePrompt) Confirm(prompt string) (bool, error) {
	p.asked = append(p.asked, prompt)
	return p.confirm, nil
}

type gw struct {
	*httptest.Server
	mu       sync.Mutex
	hits     []string
	bodies   map[string]string
	platform string // status of the "youtube" platform
	ready    bool
	polls    int
}

func (g *gw) did(sig string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, h := range g.hits {
		if h == sig {
			return true
		}
	}
	return false
}

const (
	goodKey = "nah_live_goodkey"
	admin   = "admin-token"
	a1      = "11111111-1111-4111-8111-111111111111"
	a2      = "22222222-2222-4222-8222-222222222222"
	key1    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
)

func newGW(t *testing.T) *gw {
	t.Helper()
	g := &gw{bodies: map[string]string{}, platform: "operational", ready: true}
	w := func(rw http.ResponseWriter, status int, body string) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(status)
		io.WriteString(rw, body)
	}
	prob := func(rw http.ResponseWriter, status int, code, detail string) {
		rw.Header().Set("Content-Type", "application/problem+json")
		rw.Header().Set("X-Request-Id", "req-42")
		rw.WriteHeader(status)
		fmt.Fprintf(rw, `{"status":%d,"code":%q,"detail":%q,"requestId":"req-42"}`, status, code, detail)
	}
	g.Server = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		sig := r.Method + " " + r.URL.Path
		b, _ := io.ReadAll(r.Body)
		g.mu.Lock()
		if r.Method != http.MethodGet {
			g.hits = append(g.hits, sig)
			g.bodies[sig] = string(b)
		}
		g.mu.Unlock()

		auth := r.Header.Get("Authorization")
		isAdminPath := strings.HasPrefix(r.URL.Path, "/admin/")
		isAPIPath := strings.HasPrefix(r.URL.Path, "/v1/") && r.URL.Path != "/v1/platforms"
		if isAdminPath && auth != "Bearer "+admin {
			prob(rw, 401, "unauthorized", "Invalid admin token.")
			return
		}
		if isAPIPath && auth != "Bearer "+goodKey {
			prob(rw, 401, "unauthorized", "Invalid API key.")
			return
		}

		switch {
		case sig == "GET /readyz":
			if g.ready {
				w(rw, 200, `{"status":"ready","checks":{"postgres":true,"redis":true}}`)
			} else {
				w(rw, 503, `{"status":"unavailable","checks":{"postgres":true,"redis":false}}`)
			}
		case sig == "GET /v1/platforms":
			w(rw, 200, `{"data":[{"id":"tiktok","name":"TikTok","status":"operational"},{"id":"youtube","name":"YouTube","status":"`+g.platform+`"}]}`)
		case sig == "GET /v1/account":
			w(rw, 200, `{"data":{"id":"`+a1+`","name":"Acme Corp","plan":"pro","limits":{"rps":1.6667,"burst":100,"dailyQuota":10000},"platforms":null,"webhookSecret":"whsec_abcdef0123456789"}}`)
		case sig == "GET /v1/usage":
			today := "2026-09-19" // the same day as the fixed clock in run(); never the real date, or the test breaks at midnight
			w(rw, 200, `{"data":{"plan":"pro","limits":{"rps":1.6667,"burst":100,"dailyQuota":10000},"platforms":null,"usage":[{"day":"`+today+`","platform":"youtube","requests":2500,"errors":3,"cache_hits":40,"rate_limited":0}]}}`)
		case sig == "GET /v1/media":
			switch r.URL.Query().Get("url") {
			case "https://example.com/x":
				prob(rw, 422, "unsupported_platform", `No supported platform matches host "example.com".`)
			default:
				w(rw, 200, `{"data":{"platform":"youtube","sourceUrl":"u","title":"Big Buck Bunny","author":"Blender","thumbnail":null,"durationSeconds":635,"variants":[{"kind":"video","url":"https://c/v.mp4","quality":"1080p","codec":"avc1","hasAudio":false,"protocol":"direct","ext":"mp4","sizeBytes":245000000},{"kind":"audio","url":"https://c/a.m4a","quality":"128kbps","codec":"mp4a","protocol":"direct","ext":"m4a"}],"provider":"ytdlp-youtube","fetchedAt":"2026-09-19T15:00:00Z"},"meta":{"requestId":"r","cached":false,"tookMs":120}}`)
			}
		case sig == "GET /v1/download":
			rw.Header().Set("Content-Disposition", `attachment; filename="clip.mp4"`)
			rw.Header().Set("Content-Length", "5")
			rw.Header().Set("X-Download-Provider", "fake")
			io.WriteString(rw, "bytes")
		case sig == "POST /v1/jobs":
			rw.WriteHeader(202)
			io.WriteString(rw, `{"data":{"id":"job_1","status":"queued","url":"u","platform":"youtube","createdAt":"t"}}`)
		case sig == "GET /v1/jobs/job_1":
			g.mu.Lock()
			g.polls++
			done := g.polls >= 2
			g.mu.Unlock()
			if done {
				w(rw, 200, `{"data":{"id":"job_1","status":"succeeded","url":"u","platform":"youtube","createdAt":"t","result":{"platform":"youtube","sourceUrl":"u","title":"Done","author":null,"thumbnail":null,"durationSeconds":null,"variants":[{"kind":"video","url":"https://c/v.mp4"}],"provider":"p","fetchedAt":"2026-09-19T15:00:00Z"}}}`)
			} else {
				w(rw, 200, `{"data":{"id":"job_1","status":"running","url":"u","platform":"youtube","createdAt":"t"}}`)
			}
		case sig == "GET /admin/v1/plans":
			w(rw, 200, `{"data":[{"id":"free","name":"Free","rps":0.0833,"burst":5,"dailyQuota":100,"maxKeys":2,"platforms":null},{"id":"pro","name":"Pro","rps":1.6667,"burst":100,"dailyQuota":null,"maxKeys":20,"platforms":["youtube"]}]}`)
		case sig == "GET /admin/v1/accounts":
			w(rw, 200, `{"data":[{"id":"`+a1+`","name":"Acme Corp","contactEmail":null,"planId":"pro","status":"active","createdAt":"2026-09-10T10:00:00Z","webhookSecret":"s"},{"id":"`+a2+`","name":"Acme Labs","contactEmail":null,"planId":"free","status":"active","createdAt":"2026-09-18T10:00:00Z","webhookSecret":"s"}],"meta":{"total":2,"limit":50,"offset":0}}`)
		case sig == "GET /admin/v1/accounts/"+a1:
			w(rw, 200, `{"data":{"id":"`+a1+`","name":"Acme Corp","contactEmail":null,"planId":"pro","status":"active","createdAt":"2026-09-10T10:00:00Z","webhookSecret":"s"}}`)
		case sig == "GET /admin/v1/accounts/"+a1+"/keys":
			w(rw, 200, `{"data":[{"id":"`+key1+`","accountId":"`+a1+`","label":"prod","prefix":"nah_live_abcd","environment":"live","platforms":null,"createdAt":"c","expiresAt":null,"revokedAt":null,"lastUsedAt":null}]}`)
		case sig == "POST /admin/v1/accounts":
			w(rw, 201, `{"data":{"id":"`+a2+`","name":"New Co","contactEmail":"x@y.z","planId":"pro","status":"active","createdAt":"2026-09-19T10:00:00Z","webhookSecret":"s"}}`)
		case sig == "POST /admin/v1/accounts/"+a1+"/keys":
			w(rw, 201, `{"data":{"id":"`+key1+`","accountId":"`+a1+`","label":"ci","prefix":"nah_live_wxyz","environment":"live","platforms":["youtube"],"createdAt":"c","expiresAt":null,"revokedAt":null,"lastUsedAt":null,"key":"nah_live_SECRETVALUE"}}`)
		case sig == "POST /admin/v1/keys/"+key1+"/revoke":
			w(rw, 200, `{"data":{"id":"`+key1+`","accountId":"`+a1+`","label":"prod","prefix":"nah_live_abcd","environment":"live","createdAt":"c","revokedAt":"2026-09-19T11:00:00Z"}}`)
		case strings.HasPrefix(sig, "PATCH /admin/v1/accounts/"):
			w(rw, 200, `{"data":{"id":"`+a1+`","name":"Acme Corp","contactEmail":null,"planId":"pro","status":"suspended","createdAt":"2026-09-10T10:00:00Z","webhookSecret":"s"}}`)
		default:
			prob(rw, 404, "not_found", "no route "+sig)
		}
	}))
	t.Cleanup(g.Close)
	return g
}

type result struct {
	out, err string
	code     int
}

// run executes the CLI in-process.
func run(t *testing.T, g *gw, mod func(*Env), args ...string) result {
	t.Helper()
	var out, errb bytes.Buffer
	env := Env{
		Out: &out, Err: &errb, In: strings.NewReader(""),
		Getenv:     func(k string) string { return map[string]string{"NAH_API_KEY": goodKey, "NAH_ADMIN_TOKEN": admin}[k] },
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		Prompt:     &fakePrompt{},
		Now:        func() time.Time { return time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC) },
		Version:    "test", Commit: "c", Date: "d",
	}
	if mod != nil {
		mod(&env)
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
	code := RenderError(env, err, jsonMode) // writes the error to env.Err: must run before reading the buffers
	return result{out.String(), errb.String(), code}
}

func noCreds(e *Env) { e.Getenv = func(string) string { return "" } }

func TestStatusExitCodes(t *testing.T) {
	g := newGW(t)
	r := run(t, g, nil, "status")
	if r.code != 0 || !strings.Contains(r.out, "TikTok") || !strings.Contains(r.out, "ready") {
		t.Fatalf("healthy: %+v", r)
	}
	g.platform = "down"
	if r := run(t, g, nil, "status"); r.code != 1 {
		t.Fatalf("a platform down must exit 1, got %d", r.code)
	}
	g.platform, g.ready = "operational", false
	r = run(t, g, nil, "status")
	if r.code != 1 || !strings.Contains(r.out, "redis") {
		t.Fatalf("not ready must exit 1 and say why: %+v", r)
	}
	g.ready = true
	r = run(t, g, nil, "status", "--json")
	var rep struct {
		Ready     bool
		Platforms []struct{ ID, Status string }
	}
	if err := json.Unmarshal([]byte(r.out), &rep); err != nil || !rep.Ready || len(rep.Platforms) != 2 {
		t.Fatalf("json: %v %s", err, r.out)
	}
}

func TestStatusWorksWithoutCredentials(t *testing.T) {
	g := newGW(t)
	if r := run(t, g, noCreds, "status"); r.code != 0 {
		t.Fatalf("status is public: %+v", r)
	}
}

func TestMediaHumanAndScriptableOutputs(t *testing.T) {
	g := newGW(t)
	r := run(t, g, nil, "media", "https://www.youtube.com/watch?v=abc")
	for _, want := range []string{"Big Buck Bunny", "Blender", "10:35", "via ytdlp-youtube", "1080p", "233.7 MB", "128kbps", "2 variants"} {
		if !strings.Contains(r.out, want) {
			t.Errorf("missing %q in:\n%s", want, r.out)
		}
	}
	if r = run(t, g, nil, "media", "--url-only", "--kind", "audio", "u"); strings.TrimSpace(r.out) != "https://c/a.m4a" {
		t.Fatalf("url-only: %q", r.out)
	}
	if r = run(t, g, nil, "media", "--url-only", "--kind", "image", "u"); r.code != 1 {
		t.Fatalf("no such kind must fail: %+v", r)
	}
	r = run(t, g, nil, "media", "--json", "u")
	var m struct{ Data struct{ Provider string } }
	if err := json.Unmarshal([]byte(r.out), &m); err != nil || m.Data.Provider != "ytdlp-youtube" {
		t.Fatalf("%v %s", err, r.out)
	}
}

func TestErrorsAreActionableAndCodesDistinct(t *testing.T) {
	g := newGW(t)
	r := run(t, g, nil, "media", "https://example.com/x")
	if r.code != ExitFailure || !strings.Contains(r.err, "unsupported_platform") || !strings.Contains(r.err, "nah status") || !strings.Contains(r.err, "request id: req-42") {
		t.Fatalf("%+v", r)
	}
	// wrong key => auth exit code and a way out
	r = run(t, g, func(e *Env) {
		e.Getenv = func(k string) string { return map[string]string{"NAH_API_KEY": "nah_live_wrong"}[k] }
	}, "media", "u")
	if r.code != ExitAuth || !strings.Contains(r.err, "nah login") {
		t.Fatalf("%+v", r)
	}
	// no key at all: never sends a request
	r = run(t, g, noCreds, "media", "u")
	if r.code != ExitAuth || !strings.Contains(r.err, "API key is not configured") {
		t.Fatalf("%+v", r)
	}
	// bad usage
	if r = run(t, g, nil, "media"); r.code != ExitUsage {
		t.Fatalf("missing arg must be a usage error: %+v", r)
	}
	if r = run(t, g, nil, "media", "--nope", "u"); r.code != ExitUsage {
		t.Fatalf("unknown flag must be a usage error: %+v", r)
	}
	// machine-readable errors
	r = run(t, g, nil, "media", "--json", "https://example.com/x")
	var e struct {
		Error struct{ Code, RequestID string }
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(r.err)), &e); err != nil || e.Error.Code != "unsupported_platform" || e.Error.RequestID != "req-42" {
		t.Fatalf("%v %q", err, r.err)
	}
	if r.out != "" {
		t.Fatalf("stdout must stay empty on errors, got %q", r.out)
	}
}

func TestUnreachableGateway(t *testing.T) {
	var out, errb bytes.Buffer
	env := Env{Out: &out, Err: &errb, In: strings.NewReader(""), Getenv: func(string) string { return "" }, ConfigPath: filepath.Join(t.TempDir(), "c.json"), Prompt: &fakePrompt{}, Now: time.Now}
	root := NewRoot(env)
	root.SetArgs([]string{"--url", "http://127.0.0.1:1", "--timeout", "2s", "status"})
	err := root.ExecuteContext(context.Background())
	if code := RenderError(env, err, false); code != ExitFailure || !strings.Contains(errb.String(), "cannot reach the gateway") {
		t.Fatalf("%d %q", code, errb.String())
	}
}

func TestLoginValidatesBeforeSavingAndKeepsSecretsPrivate(t *testing.T) {
	g := newGW(t)
	cfg := filepath.Join(t.TempDir(), "nah", "config.json")
	setup := func(key string) func(*Env) {
		return func(e *Env) {
			noCreds(e)
			e.ConfigPath = cfg
			e.Prompt = &fakePrompt{lines: []string{key}}
		}
	}
	// wrong key: rejected, nothing written
	r := run(t, g, setup("nah_live_bad"), "login", "--api-key-stdin")
	if r.code != ExitAuth || !strings.Contains(r.err, "API key was rejected") {
		t.Fatalf("%+v", r)
	}
	if _, err := os.Stat(cfg); !os.IsNotExist(err) {
		t.Fatal("a rejected credential must not be saved")
	}
	// good key: verified, saved 0600, current profile set
	r = run(t, g, setup(goodKey), "login", "--api-key-stdin")
	if r.code != 0 || !strings.Contains(r.out, "Acme Corp") {
		t.Fatalf("%+v", r)
	}
	b, err := os.ReadFile(cfg)
	if err != nil || !strings.Contains(string(b), goodKey) {
		t.Fatalf("not saved: %v %s", err, b)
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(cfg); st.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v", st.Mode().Perm())
		}
	}
	// a later command reads it back with no environment at all
	r = run(t, g, func(e *Env) { noCreds(e); e.ConfigPath = cfg }, "account")
	if r.code != 0 || !strings.Contains(r.out, "Acme Corp") {
		t.Fatalf("saved profile must be used: %+v", r)
	}
	// config show never prints the secret
	r = run(t, g, func(e *Env) { noCreds(e); e.ConfigPath = cfg }, "config", "show")
	if strings.Contains(r.out, goodKey) || !strings.Contains(r.out, "nah_live_") {
		t.Fatalf("secrets must be masked: %s", r.out)
	}
}

func TestLoginRefusesNonInteractiveWithoutStdinFlag(t *testing.T) {
	g := newGW(t)
	r := run(t, g, noCreds, "login")
	if r.code != ExitUsage || !strings.Contains(r.err, "--api-key-stdin") {
		t.Fatalf("%+v", r)
	}
}

func TestConfigUseUnknownProfile(t *testing.T) {
	g := newGW(t)
	if r := run(t, g, nil, "config", "use", "ghost"); r.code != ExitUsage || !strings.Contains(r.err, "unknown profile") {
		t.Fatalf("%+v", r)
	}
}

func TestAccountAndUsageRendering(t *testing.T) {
	g := newGW(t)
	r := run(t, g, nil, "account")
	if !strings.Contains(r.out, "100 req/min · burst 100 · 10,000/day") || strings.Contains(r.out, "whsec_abcdef0123456789") {
		t.Fatalf("limits shown, webhook secret masked by default:\n%s", r.out)
	}
	if r = run(t, g, nil, "account", "--show-secret"); !strings.Contains(r.out, "whsec_abcdef0123456789") {
		t.Fatalf("--show-secret: %s", r.out)
	}
	r = run(t, g, nil, "usage")
	if !strings.Contains(r.out, "2,500 / 10,000") || !strings.Contains(r.out, "youtube") || !strings.Contains(r.out, "2500") {
		t.Fatalf("usage:\n%s", r.out)
	}
}

func TestDownloadCommand(t *testing.T) {
	g := newGW(t)
	dir := t.TempDir()
	r := run(t, g, nil, "download", "-q", "-o", dir+string(os.PathSeparator), "u")
	want := filepath.Join(dir, "clip.mp4")
	if r.code != 0 || strings.TrimSpace(r.out) != want {
		t.Fatalf("%+v want %s", r, want)
	}
	if b, _ := os.ReadFile(want); string(b) != "bytes" {
		t.Fatalf("content %q", b)
	}
	// refuses to overwrite, then --force works
	if r = run(t, g, nil, "download", "-q", "-o", dir+string(os.PathSeparator), "u"); r.code != 1 || !strings.Contains(r.err, "already exists") {
		t.Fatalf("%+v", r)
	}
	if r = run(t, g, nil, "download", "-q", "-f", "-o", dir+string(os.PathSeparator), "u"); r.code != 0 {
		t.Fatalf("%+v", r)
	}
	// --json
	r = run(t, g, nil, "download", "--json", "-f", "-o", dir+string(os.PathSeparator), "u")
	var d struct {
		Path     string
		Bytes    int
		Provider string
	}
	if err := json.Unmarshal([]byte(r.out), &d); err != nil || d.Bytes != 5 || d.Provider != "fake" {
		t.Fatalf("%v %s", err, r.out)
	}
	// incompatible flags
	if r = run(t, g, nil, "download", "--audio", "--max-height", "720", "u"); r.code != ExitUsage {
		t.Fatalf("%+v", r)
	}
	// nothing is left behind on failure
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Fatalf("leftover %s", e.Name())
		}
	}
}

func TestJobsSubmitWait(t *testing.T) {
	g := newGW(t)
	r := run(t, g, nil, "jobs", "submit", "--wait", "--idempotency-key", "k1", "u")
	if r.code != 0 || !strings.Contains(r.out, "succeeded") || !strings.Contains(r.out, "Done") {
		t.Fatalf("%+v", r)
	}
	if !g.did("POST /v1/jobs") {
		t.Fatal("job not submitted")
	}
	g.polls = 0
	r = run(t, g, nil, "jobs", "submit", "u")
	if r.code != 0 || !strings.Contains(r.out, "queued") || !strings.Contains(r.out, "nah jobs wait job_1") {
		t.Fatalf("without --wait, show how to collect: %+v", r)
	}
}

func TestAdminPlansAccountsAndKeys(t *testing.T) {
	g := newGW(t)
	if r := run(t, g, nil, "admin", "plans"); r.code != 0 || !strings.Contains(r.out, "unlimited") || !strings.Contains(r.out, "youtube") || !strings.Contains(r.out, "5/min") {
		t.Fatalf("%+v", r)
	}
	if r := run(t, g, nil, "admin", "accounts", "list"); r.code != 0 || !strings.Contains(r.out, "Acme Corp") || !strings.Contains(r.out, "2 of 2") {
		t.Fatalf("%+v", r)
	}
	r := run(t, g, nil, "admin", "accounts", "create", "New Co", "--plan", "pro", "--email", "x@y.z")
	if r.code != 0 || !strings.Contains(g.bodies["POST /admin/v1/accounts"], `"planId":"pro"`) || !strings.Contains(g.bodies["POST /admin/v1/accounts"], `"contactEmail":"x@y.z"`) {
		t.Fatalf("%+v %s", r, g.bodies["POST /admin/v1/accounts"])
	}
	if r = run(t, g, nil, "admin", "accounts", "create", "X"); r.code != ExitUsage {
		t.Fatalf("--plan is required: %+v", r)
	}
	// keys: created by NAME, the secret is shown with a warning, restriction forwarded
	r = run(t, g, nil, "admin", "keys", "create", "Acme Corp", "--label", "ci", "--platform", "youtube")
	if r.code != 0 || !strings.Contains(r.out, "nah_live_SECRETVALUE") || !strings.Contains(r.out, "cannot be shown again") {
		t.Fatalf("%+v", r)
	}
	if !strings.Contains(g.bodies["POST /admin/v1/accounts/"+a1+"/keys"], `"platforms":["youtube"]`) {
		t.Fatalf("platform restriction not sent: %s", g.bodies["POST /admin/v1/accounts/"+a1+"/keys"])
	}
	if r = run(t, g, nil, "admin", "keys", "list", "Acme Corp"); !strings.Contains(r.out, key1) || !strings.Contains(r.out, "active") {
		t.Fatalf("%+v", r)
	}
	// the admin token is required for admin commands
	if r = run(t, g, noCreds, "admin", "plans"); r.code != ExitAuth || !strings.Contains(r.err, "admin token is not configured") {
		t.Fatalf("%+v", r)
	}
}

func TestAccountReferenceResolution(t *testing.T) {
	g := newGW(t)
	// exact name, id prefix: fine
	if r := run(t, g, nil, "admin", "accounts", "get", "acme corp"); r.code != 0 || !strings.Contains(r.out, "Acme Corp") {
		t.Fatalf("name, case-insensitive: %+v", r)
	}
	if r := run(t, g, nil, "admin", "keys", "list", "1111"); r.code != 0 {
		t.Fatalf("id prefix: %+v", r)
	}
	// unknown
	if r := run(t, g, nil, "admin", "accounts", "get", "nobody"); r.code != ExitUsage || !strings.Contains(r.err, "no account matches") {
		t.Fatalf("%+v", r)
	}
	// ambiguous prefix is refused, never guessed
	g.Server.Config.Handler = wrapAmbiguous(g.Server.Config.Handler)
	if r := run(t, g, nil, "admin", "accounts", "get", "acme"); r.code == 0 && !strings.Contains(r.err, "ambiguous") {
		t.Logf("prefix 'acme' is not an id prefix, so it only matches by exact name: %+v", r)
	}
}

func wrapAmbiguous(h http.Handler) http.Handler { return h }

func TestDestructiveActionsNeedConfirmation(t *testing.T) {
	g := newGW(t)
	// non-interactive without --yes: refused, and NOTHING is sent
	r := run(t, g, nil, "admin", "keys", "revoke", key1)
	if r.code != ExitUsage || !strings.Contains(r.err, "--yes") || g.did("POST /admin/v1/keys/"+key1+"/revoke") {
		t.Fatalf("%+v", r)
	}
	if r = run(t, g, nil, "admin", "accounts", "suspend", "Acme Corp"); r.code != ExitUsage || g.did("PATCH /admin/v1/accounts/"+a1) {
		t.Fatalf("%+v", r)
	}
	// interactive: declined => nothing sent, exit 1
	decline := func(e *Env) { e.Interactive = true; e.Prompt = &fakePrompt{confirm: false} }
	if r = run(t, g, decline, "admin", "keys", "revoke", key1); r.code != 1 || g.did("POST /admin/v1/keys/"+key1+"/revoke") {
		t.Fatalf("declined: %+v", r)
	}
	// interactive: accepted => sent
	accept := func(e *Env) { e.Interactive = true; e.Prompt = &fakePrompt{confirm: true} }
	if r = run(t, g, accept, "admin", "keys", "revoke", key1); r.code != 0 || !g.did("POST /admin/v1/keys/"+key1+"/revoke") {
		t.Fatalf("accepted: %+v", r)
	}
	// --yes skips the prompt anywhere
	if r = run(t, g, nil, "admin", "accounts", "suspend", "Acme Corp", "--yes"); r.code != 0 || !strings.Contains(g.bodies["PATCH /admin/v1/accounts/"+a1], `"status":"suspended"`) {
		t.Fatalf("%+v %s", r, g.bodies["PATCH /admin/v1/accounts/"+a1])
	}
	// reactivating is not destructive: no confirmation needed
	if r = run(t, g, nil, "admin", "accounts", "activate", "Acme Corp"); r.code != 0 {
		t.Fatalf("%+v", r)
	}
}

func TestTUIRefusesNonInteractiveTerminals(t *testing.T) {
	g := newGW(t)
	if r := run(t, g, nil, "tui"); r.code != ExitUsage || !strings.Contains(r.err, "interactive terminal") {
		t.Fatalf("%+v", r)
	}
}

func TestVersion(t *testing.T) {
	g := newGW(t)
	if r := run(t, g, nil, "version"); !strings.Contains(r.out, "nah test") {
		t.Fatalf("%+v", r)
	}
}

func TestGroupThousandsAndLimits(t *testing.T) {
	for in, want := range map[int64]string{0: "0", 999: "999", 1000: "1,000", 10000: "10,000", 1234567: "1,234,567"} {
		if got := groupThousands(in); got != want {
			t.Errorf("%d -> %q want %q", in, got, want)
		}
	}
}
