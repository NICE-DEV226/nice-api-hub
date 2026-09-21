package tui

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
)

// fakeGateway emulates the parts of the gateway the interface talks to and records mutating calls.
type fakeGateway struct {
	*httptest.Server
	mu    sync.Mutex
	calls []string
	body  map[string]string // last JSON body per "METHOD path"
}

func (g *fakeGateway) called(sig string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, c := range g.calls {
		if c == sig {
			return true
		}
	}
	return false
}

func (g *fakeGateway) lastBody(sig string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.body[sig]
}

const acct1 = "11111111-1111-4111-8111-111111111111"
const acct2 = "22222222-2222-4222-8222-222222222222"

func newFakeGateway(t *testing.T) *fakeGateway {
	t.Helper()
	g := &fakeGateway{body: map[string]string{}}
	today := time.Now().UTC().Format("2006-01-02")
	mux := http.NewServeMux()
	js := func(w http.ResponseWriter, status int, v string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, v)
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		sig := r.Method + " " + r.URL.Path
		b, _ := io.ReadAll(r.Body)
		g.mu.Lock()
		if r.Method != http.MethodGet {
			g.calls = append(g.calls, sig)
			g.body[sig] = string(b)
		}
		g.mu.Unlock()

		switch {
		case sig == "GET /readyz":
			js(w, 200, `{"status":"ready","checks":{"postgres":true,"redis":true}}`)
		case sig == "GET /v1/platforms":
			js(w, 200, `{"data":[{"id":"tiktok","name":"TikTok","status":"operational"},{"id":"youtube","name":"YouTube","status":"degraded"},{"id":"twitter","name":"X (Twitter)","status":"down"}]}`)
		case sig == "GET /v1/account":
			js(w, 200, `{"data":{"id":"`+acct1+`","name":"Acme Corp","plan":"pro","limits":{"rps":1.6667,"burst":100,"dailyQuota":10000},"platforms":null,"webhookSecret":"s"}}`)
		case sig == "GET /v1/usage":
			js(w, 200, `{"data":{"plan":"pro","limits":{"rps":1.6667,"burst":100,"dailyQuota":10000},"platforms":null,"usage":[{"day":"`+today+`","platform":"youtube","requests":250,"errors":3,"cache_hits":40,"rate_limited":0}]}}`)
		case sig == "GET /admin/v1/plans":
			js(w, 200, `{"data":[{"id":"free","name":"Free","rps":0.0833,"burst":5,"dailyQuota":100,"maxKeys":2,"platforms":null},{"id":"pro","name":"Pro","rps":1.6667,"burst":100,"dailyQuota":10000,"maxKeys":20,"platforms":null}]}`)
		case sig == "GET /admin/v1/accounts":
			js(w, 200, `{"data":[{"id":"`+acct1+`","name":"Acme Corp","contactEmail":"ops@acme.test","planId":"pro","status":"active","createdAt":"2026-09-10T10:00:00Z","webhookSecret":"s"},{"id":"`+acct2+`","name":"Beta Inc","contactEmail":null,"planId":"free","status":"suspended","createdAt":"2026-09-18T10:00:00Z","webhookSecret":"s"}],"meta":{"total":2,"limit":100,"offset":0}}`)
		case sig == "GET /admin/v1/accounts/"+acct1+"/keys":
			js(w, 200, `{"data":[{"id":"k1000000-0000-4000-8000-000000000001","accountId":"`+acct1+`","label":"prod","prefix":"nah_live_abcd","environment":"live","platforms":null,"createdAt":"2026-09-10T10:00:00Z","expiresAt":null,"revokedAt":null,"lastUsedAt":"2026-09-19T10:00:00Z"}]}`)
		case sig == "GET /admin/v1/accounts/"+acct2+"/keys":
			js(w, 200, `{"data":[]}`)
		case strings.HasPrefix(sig, "GET /admin/v1/accounts/") && strings.HasSuffix(sig, "/usage"):
			js(w, 200, `{"data":[{"day":"`+today+`","platform":"youtube","requests":250,"errors":3,"cache_hits":40,"rate_limited":0}]}`)
		case sig == "POST /admin/v1/accounts":
			js(w, 201, `{"data":{"id":"33333333-3333-4333-8333-333333333333","name":"New Co","contactEmail":null,"planId":"free","status":"active","createdAt":"2026-09-19T10:00:00Z","webhookSecret":"s"}}`)
		case sig == "POST /admin/v1/accounts/"+acct1+"/keys":
			js(w, 201, `{"data":{"id":"k2000000-0000-4000-8000-000000000002","accountId":"`+acct1+`","label":"ci-key","prefix":"nah_live_wxyz","environment":"live","platforms":null,"createdAt":"2026-09-19T10:00:00Z","expiresAt":null,"revokedAt":null,"lastUsedAt":null,"key":"nah_live_SECRETSECRETSECRETSECRET0000"}}`)
		case sig == "POST /admin/v1/keys/k1000000-0000-4000-8000-000000000001/revoke":
			js(w, 200, `{"data":{"id":"k1000000-0000-4000-8000-000000000001","accountId":"`+acct1+`","label":"prod","prefix":"nah_live_abcd","environment":"live","createdAt":"c","revokedAt":"2026-09-19T11:00:00Z"}}`)
		case strings.HasPrefix(sig, "PATCH /admin/v1/accounts/"):
			js(w, 200, `{"data":{"id":"`+acct1+`","name":"Acme Corp","contactEmail":null,"planId":"pro","status":"suspended","createdAt":"2026-09-10T10:00:00Z","webhookSecret":"s"}}`)
		case sig == "GET /v1/media":
			js(w, 200, `{"data":{"platform":"youtube","sourceUrl":"https://www.youtube.com/watch?v=abc","title":"Big Buck Bunny","author":"Blender","thumbnail":null,"durationSeconds":635,"variants":[{"kind":"video","url":"https://c/v.mp4","quality":"1080p","codec":"avc1","height":1080,"hasAudio":false,"protocol":"direct","ext":"mp4","sizeBytes":245000000},{"kind":"audio","url":"https://c/a.m4a","quality":"128kbps","codec":"mp4a","protocol":"direct","ext":"m4a"}],"provider":"ytdlp-youtube","fetchedAt":"2026-09-19T15:00:00Z"},"meta":{"requestId":"r","cached":false,"tookMs":11800}}`)
		case sig == "GET /v1/download":
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Disposition", `attachment; filename="Big Buck Bunny.mp4"`)
			w.Header().Set("Content-Length", "11")
			w.Header().Set("X-Download-Provider", "ytdlp-youtube")
			io.WriteString(w, "hello world")
		default:
			js(w, 404, `{"type":"x","title":"Not Found","status":404,"code":"not_found","detail":"no route `+sig+`"}`)
		}
	})
	g.Server = httptest.NewServer(mux)
	t.Cleanup(g.Close)
	return g
}

func testDeps(t *testing.T, g *fakeGateway, api_, admin bool) Deps {
	t.Helper()
	c, err := api.New(g.URL, "nah_live_test", "admin")
	if err != nil {
		t.Fatal(err)
	}
	return Deps{Client: c, Profile: "test", HasAPI: api_, HasAdmin: admin, DownloadDir: t.TempDir(), Copy: func(string) tea.Cmd { return nil }}
}

func start(t *testing.T, d Deps, w, h int) *teatest.TestModel {
	t.Helper()
	a := NewApp(d)
	a.active = 0 // the app opens on the Playground when there is an API key; most tests begin on the first tab
	return teatest.NewTestModel(t, a, teatest.WithInitialTermSize(w, h))
}

func waitFor(t *testing.T, tm *teatest.TestModel, needles ...string) {
	t.Helper()
	teatest.WaitFor(t, tm.Output(), func(b []byte) bool {
		for _, n := range needles {
			if !bytes.Contains(b, []byte(n)) {
				return false
			}
		}
		return true
	}, teatest.WithDuration(6*time.Second), teatest.WithCheckInterval(20*time.Millisecond))
}

func press(s string) tea.KeyMsg {
	switch s {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "tab":
		return tea.KeyMsg{Type: tea.KeyTab}
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}
	}
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
}

func eventually(t *testing.T, cond func() bool, what string) {
	t.Helper()
	end := time.Now().Add(6 * time.Second)
	for time.Now().Before(end) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for: %s", what)
}

func TestDashboardShowsHealthPlatformsAndQuota(t *testing.T) {
	g := newFakeGateway(t)
	tm := start(t, testDeps(t, g, true, true), 130, 40)
	waitFor(t, tm, "Gateway", "postgres", "TikTok", "operational", "degraded", "down", "Acme Corp", "250 / 10000")
	tm.Send(press("q"))
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestTabsAdaptToCredentials(t *testing.T) {
	g := newFakeGateway(t)
	only := NewApp(testDeps(t, g, true, false))
	if len(only.tabs) != 2 || only.tabs[1].title != "Download" {
		t.Fatalf("API key only => Dashboard + Playground, got %+v", only.tabs)
	}
	adm := NewApp(testDeps(t, g, false, true))
	if len(adm.tabs) != 2 || adm.tabs[1].title != "Accounts" {
		t.Fatalf("admin only => Dashboard + Accounts, got %+v", adm.tabs)
	}
	none := NewApp(testDeps(t, g, false, false))
	if len(none.tabs) != 1 {
		t.Fatalf("no credentials => Dashboard only, got %d tabs", len(none.tabs))
	}
}

func TestUnreachableGatewayShowsAHelpfulPanel(t *testing.T) {
	c, _ := api.New("http://127.0.0.1:1", "k", "a")
	a := NewApp(Deps{Client: c, Profile: "x", HasAPI: true})
	a.active = 0
	tm := teatest.NewTestModel(t, a, teatest.WithInitialTermSize(110, 30))
	waitFor(t, tm, "Cannot reach the gateway", "docker compose ps")
	tm.Send(press("q"))
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestTooSmallTerminal(t *testing.T) {
	g := newFakeGateway(t)
	tm := start(t, testDeps(t, g, true, true), 40, 10)
	waitFor(t, tm, "Terminal too small")
	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestAccountsBrowseAndKeys(t *testing.T) {
	g := newFakeGateway(t)
	tm := start(t, testDeps(t, g, true, true), 130, 40)
	tm.Send(press("2"))
	waitFor(t, tm, "Accounts (2)", "Acme Corp", "Beta Inc", "nah_live_abcd", "prod", "ops@acme.test")
	tm.Send(press("q"))
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestCreateKeyShowsTheSecretOnceAndCallsTheAPI(t *testing.T) {
	g := newFakeGateway(t)
	tm := start(t, testDeps(t, g, true, true), 130, 40)
	tm.Send(press("2"))
	waitFor(t, tm, "Acme Corp", "nah_live_abcd")
	tm.Send(press("c"))
	waitFor(t, tm, "New API key")
	tm.Type("ci-key")
	tm.Send(press("enter"))
	waitFor(t, tm, "API key created", "nah_live_SECRETSECRETSECRETSECRET0000", "cannot be shown again")
	eventually(t, func() bool { return g.called("POST /admin/v1/accounts/" + acct1 + "/keys") }, "the key creation request")
	if !strings.Contains(g.lastBody("POST /admin/v1/accounts/"+acct1+"/keys"), `"label":"ci-key"`) {
		t.Fatalf("label not sent: %s", g.lastBody("POST /admin/v1/accounts/"+acct1+"/keys"))
	}
	tm.Send(press("esc"))
	tm.Send(press("q"))
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestCreateAccountUsesTheChosenPlan(t *testing.T) {
	g := newFakeGateway(t)
	tm := start(t, testDeps(t, g, true, true), 130, 40)
	tm.Send(press("2"))
	waitFor(t, tm, "Acme Corp")
	tm.Send(press("n"))
	waitFor(t, tm, "New account", "free")
	tm.Type("New Co")
	tm.Send(press("down")) // free -> pro
	waitFor(t, tm, "‹ pro ›")
	tm.Send(press("enter"))
	eventually(t, func() bool { return g.called("POST /admin/v1/accounts") }, "the account creation request")
	body := g.lastBody("POST /admin/v1/accounts")
	if !strings.Contains(body, `"name":"New Co"`) || !strings.Contains(body, `"planId":"pro"`) {
		t.Fatalf("bad body: %s", body)
	}
	tm.Send(press("q"))
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestRevokeNeedsConfirmation(t *testing.T) {
	g := newFakeGateway(t)
	tm := start(t, testDeps(t, g, true, true), 130, 40)
	tm.Send(press("2"))
	waitFor(t, tm, "nah_live_abcd")
	tm.Send(press("tab")) // focus the keys pane
	tm.Send(press("x"))
	waitFor(t, tm, "Confirm", "Revoke key", "any other key cancels")
	tm.Send(press("n")) // cancel
	time.Sleep(150 * time.Millisecond)
	if g.called("POST /admin/v1/keys/k1000000-0000-4000-8000-000000000001/revoke") {
		t.Fatal("cancelling must not revoke anything")
	}
	tm.Send(press("x"))
	waitFor(t, tm, "Revoke key")
	tm.Send(press("y"))
	eventually(t, func() bool { return g.called("POST /admin/v1/keys/k1000000-0000-4000-8000-000000000001/revoke") }, "the revoke request after confirming")
	tm.Send(press("q"))
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestSuspendNeedsConfirmationButActivateDoesNot(t *testing.T) {
	g := newFakeGateway(t)
	tm := start(t, testDeps(t, g, true, true), 130, 40)
	tm.Send(press("2"))
	waitFor(t, tm, "Acme Corp")
	tm.Send(press("s"))
	waitFor(t, tm, "Suspend", "API keys stop")
	tm.Send(press("y"))
	eventually(t, func() bool { return g.called("PATCH /admin/v1/accounts/" + acct1) }, "the suspend request")
	if !strings.Contains(g.lastBody("PATCH /admin/v1/accounts/"+acct1), `"status":"suspended"`) {
		t.Fatalf("wrong status: %s", g.lastBody("PATCH /admin/v1/accounts/"+acct1))
	}
	tm.Send(press("q"))
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestPlaygroundResolvesAndDownloads(t *testing.T) {
	g := newFakeGateway(t)
	d := testDeps(t, g, true, false)
	tm := start(t, d, 130, 40)
	tm.Send(press("2")) // only Dashboard + Playground here, so "2" is the Playground
	waitFor(t, tm, "Paste a media URL")
	tm.Type("https://www.youtube.com/watch?v=abc")
	tm.Send(press("enter"))
	waitFor(t, tm, "Big Buck Bunny", "ytdlp-youtube", "Best quality", "1080p", "233.7 MB", "Audio only", "MP3")
	tm.Send(press("d"))
	waitFor(t, tm, "Saved", "Big Buck Bunny.mp4")
	b, err := os.ReadFile(filepath.Join(d.DownloadDir, "Big Buck Bunny.mp4"))
	if err != nil || string(b) != "hello world" {
		t.Fatalf("download not saved correctly: %v %q", err, b)
	}
	tm.Send(press("esc")) // back to the URL box
	tm.Send(press("q"))   // typing into the box: must NOT quit
	time.Sleep(150 * time.Millisecond)
	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

func TestPlaygroundSurfacesGatewayErrors(t *testing.T) {
	g := newFakeGateway(t)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/media" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(422)
			io.WriteString(w, `{"status":422,"code":"content_unavailable","detail":"The requested media is unavailable or private."}`)
			return
		}
		g.Config.Handler.ServeHTTP(w, r)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c, _ := api.New(srv.URL, "k", "a")
	tm := teatest.NewTestModel(t, NewApp(Deps{Client: c, Profile: "t", HasAPI: true, Copy: func(string) tea.Cmd { return nil }}), teatest.WithInitialTermSize(120, 36))
	waitFor(t, tm, "Paste a media URL") // with an API key the app opens on the Playground
	tm.Type("https://www.tiktok.com/@x/video/1")
	tm.Send(press("enter"))
	waitFor(t, tm, "content_unavailable", "private, removed")
	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
	tm.WaitFinished(t, teatest.WithFinalTimeout(3*time.Second))
}

var _ = json.Marshal
var _ = fmt.Sprint
