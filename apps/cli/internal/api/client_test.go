package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newTestClient(t *testing.T, h http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c, err := New(srv.URL, "nah_live_testkey", "admin-token")
	if err != nil {
		t.Fatal(err)
	}
	return c, srv
}

func problem(w http.ResponseWriter, status int, code, detail string, hdr map[string]string) {
	for k, v := range hdr {
		w.Header().Set(k, v)
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	fmt.Fprintf(w, `{"type":"urn:x","title":"t","status":%d,"code":%q,"detail":%q,"requestId":"req-1","attempts":[{"provider":"a","outcome":"timeout"}]}`, status, code, detail)
}

func TestNewValidatesURL(t *testing.T) {
	for _, bad := range []string{"", "localhost:3000", "ftp://x", "http://", "not a url"} {
		if _, err := New(bad, "", ""); err == nil {
			t.Errorf("New(%q) should fail", bad)
		}
	}
	c, err := New("http://localhost:3000/", "", "")
	if err != nil || c.BaseURL != "http://localhost:3000" {
		t.Fatalf("trailing slash should be trimmed, got %v %v", c, err)
	}
}

func TestMediaSendsAuthAndEncodesURL(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer nah_live_testkey" {
			t.Errorf("missing bearer: %q", r.Header.Get("Authorization"))
		}
		if got := r.URL.Query().Get("url"); got != "https://www.youtube.com/watch?v=abc&t=1" {
			t.Errorf("url not round-tripped: %q", got)
		}
		io.WriteString(w, `{"data":{"platform":"youtube","sourceUrl":"u","title":"T","author":null,"thumbnail":null,"durationSeconds":12.5,"variants":[{"kind":"video","url":"https://c/v.mp4","height":720,"hasAudio":false}],"provider":"ytdlp-youtube","fetchedAt":"2026-09-19T15:00:00Z"},"meta":{"requestId":"r","cached":true,"tookMs":3}}`)
	})
	got, err := c.Media(context.Background(), "https://www.youtube.com/watch?v=abc&t=1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Data.Provider != "ytdlp-youtube" || !got.Meta.Cached || got.Data.Variants[0].HasAudio == nil || *got.Data.Variants[0].HasAudio {
		t.Fatalf("bad decode: %+v", got)
	}
	if got.Data.Author != nil {
		t.Fatal("null author should stay nil")
	}
}

func TestProblemDecoding(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("url") {
		case "gone":
			problem(w, 422, "content_unavailable", "private", nil)
		case "slow":
			problem(w, 429, "rate_limited", "slow down", map[string]string{"Retry-After": "7"})
		case "html":
			w.WriteHeader(502)
			io.WriteString(w, "<html>bad gateway</html>")
		}
	})
	_, err := c.Media(context.Background(), "gone")
	var p *Problem
	if !errors.As(err, &p) || p.Code != "content_unavailable" || p.Status != 422 || p.RequestID != "req-1" {
		t.Fatalf("bad problem: %#v", err)
	}
	if p.Extra["attempts"] == nil {
		t.Fatal("extension members (attempts) should be kept")
	}
	if !IsCode(err, "content_unavailable") || IsCode(err, "other") {
		t.Fatal("IsCode")
	}

	_, err = c.Media(context.Background(), "slow")
	errors.As(err, &p)
	if p.RetryAfter != 7*time.Second || !strings.Contains(p.Hint(), "7s") {
		t.Fatalf("retry-after not parsed: %v / %q", p.RetryAfter, p.Hint())
	}

	_, err = c.Media(context.Background(), "html")
	if !errors.As(err, &p) || p.Code != "http_502" || p.Status != 502 {
		t.Fatalf("non-JSON error should degrade gracefully: %#v", err)
	}
}

func TestMissingCredentialsFailBeforeAnyRequest(t *testing.T) {
	var hits int32
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) { atomic.AddInt32(&hits, 1) })
	c.APIKey, c.AdminToken = "", ""
	if _, err := c.Media(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "nah login") {
		t.Fatalf("want a helpful error, got %v", err)
	}
	if _, err := c.Plans(context.Background()); err == nil {
		t.Fatal("admin call without token must fail")
	}
	var nc *ErrNotConfigured
	if _, err := c.Account(context.Background()); !errors.As(err, &nc) {
		t.Fatalf("want ErrNotConfigured, got %T", err)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("no request should have been sent")
	}
}

func TestUnreachableGatewayMessage(t *testing.T) {
	c, err := New("http://127.0.0.1:1", "k", "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Platforms(context.Background())
	if err == nil || !strings.Contains(err.Error(), "cannot reach the gateway at http://127.0.0.1:1") {
		t.Fatalf("got %v", err)
	}
}

func TestReadyAccepts503(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		io.WriteString(w, `{"status":"unavailable","checks":{"postgres":true,"redis":false}}`)
	})
	r, err := c.Ready(context.Background())
	if err != nil || r.Status != "unavailable" || r.Checks["redis"] {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestDownload(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("url") == "bad" {
			problem(w, 422, "no_such_media", "no video", nil)
			return
		}
		if q.Get("kind") != "audio" || q.Get("maxHeight") != "720" || q.Get("audioFormat") != "mp3" {
			t.Errorf("params not forwarded: %v", q)
		}
		w.Header().Set("Content-Disposition", `attachment; filename="Été.mp3"; filename*=UTF-8''%C3%89t%C3%A9.mp3`)
		w.Header().Set("X-Download-Provider", "ytdlp-youtube")
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("Content-Length", "5")
		io.WriteString(w, "hello")
	})
	s, err := c.Download(context.Background(), DownloadRequest{URL: "u", Kind: "audio", MaxHeight: 720, AudioFormat: "mp3"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	b, _ := io.ReadAll(s.Body)
	if string(b) != "hello" || s.ContentLength != 5 || s.Filename != "Été.mp3" || s.Provider != "ytdlp-youtube" {
		t.Fatalf("%q %+v", b, s)
	}
	if _, err := c.Download(context.Background(), DownloadRequest{URL: "bad"}); !IsCode(err, "no_such_media") {
		t.Fatalf("errors before the first byte must be problems: %v", err)
	}
}

func TestFilenameFromDispositionIsSafe(t *testing.T) {
	cases := map[string]string{
		`attachment; filename="clip.mp4"`:             "clip.mp4",
		`attachment; filename="../../etc/passwd"`:     "passwd",
		`attachment; filename="..\\..\\evil.sh"`:      "evil.sh",
		`attachment; filename="/abs/path/x.mp4"`:      "x.mp4",
		`attachment; filename="a` + "\x01" + `b.mp4"`: "ab.mp4",
		``:                          "",
		`inline`:                    "",
		`attachment; filename=".."`: "",
	}
	for in, want := range cases {
		if got := FilenameFromDisposition(in); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
}

func TestJobsIdempotencyAndWait(t *testing.T) {
	var polls int32
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/jobs":
			if r.Header.Get("Idempotency-Key") != "order-1" {
				t.Errorf("idempotency key missing")
			}
			w.WriteHeader(202)
			io.WriteString(w, `{"data":{"id":"job_1","status":"queued","url":"u","platform":"tiktok","createdAt":"t"}}`)
		case r.URL.Path == "/v1/jobs/job_1":
			n := atomic.AddInt32(&polls, 1)
			st := "running"
			if n >= 3 {
				st = "succeeded"
			}
			io.WriteString(w, `{"data":{"id":"job_1","status":"`+st+`","url":"u","platform":"tiktok","createdAt":"t"}}`)
		}
	})
	j, err := c.SubmitJob(context.Background(), "u", "", "order-1")
	if err != nil || j.ID != "job_1" || j.Done() {
		t.Fatalf("%+v %v", j, err)
	}
	var seen []string
	final, err := c.WaitJob(context.Background(), "job_1", time.Millisecond, func(j Job) { seen = append(seen, j.Status) })
	if err != nil || final.Status != "succeeded" || len(seen) != 3 {
		t.Fatalf("%+v %v %v", final, err, seen)
	}
}

func TestWaitJobHonoursCancellation(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data":{"id":"j","status":"running"}}`)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := c.WaitJob(ctx, "j", 10*time.Millisecond, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want deadline exceeded, got %v", err)
	}
}

func TestAdminEndpoints(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			t.Errorf("admin calls must use the admin token, got %q", r.Header.Get("Authorization"))
		}
		switch {
		case r.URL.Path == "/admin/v1/accounts" && r.Method == http.MethodGet:
			if r.URL.Query().Get("limit") != "50" || r.URL.Query().Get("offset") != "100" {
				t.Errorf("pagination: %v", r.URL.Query())
			}
			io.WriteString(w, `{"data":[{"id":"a1","name":"Acme","contactEmail":null,"planId":"pro","status":"active","createdAt":"2026-09-19T10:00:00Z","webhookSecret":"s"}],"meta":{"total":151,"limit":50,"offset":100}}`)
		case r.URL.Path == "/admin/v1/accounts/a1/keys" && r.Method == http.MethodPost:
			io.WriteString(w, `{"data":{"id":"k1","accountId":"a1","label":"prod","prefix":"nah_live_abcd","environment":"live","platforms":null,"createdAt":"c","expiresAt":null,"revokedAt":null,"lastUsedAt":null,"key":"nah_live_SECRET"}}`)
		case r.URL.Path == "/admin/v1/keys/k1/revoke":
			io.WriteString(w, `{"data":{"id":"k1","accountId":"a1","label":"prod","prefix":"p","environment":"live","createdAt":"c","revokedAt":"2026-09-19T11:00:00Z"}}`)
		}
	})
	accs, page, err := c.Accounts(context.Background(), 50, 100)
	if err != nil || len(accs) != 1 || page.Total != 151 || accs[0].ContactEmail != nil {
		t.Fatalf("%+v %+v %v", accs, page, err)
	}
	k, err := c.CreateKey(context.Background(), "a1", "prod", "", nil)
	if err != nil || k.Secret != "nah_live_SECRET" {
		t.Fatalf("%+v %v", k, err)
	}
	r, err := c.RevokeKey(context.Background(), "k1")
	if err != nil || r.State(time.Now()) != "revoked" {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestKeyState(t *testing.T) {
	now := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	past, future := "2026-09-19T11:00:00Z", "2026-09-20T11:00:00Z"
	if (Key{}).State(now) != "active" || (Key{RevokedAt: &past}).State(now) != "revoked" ||
		(Key{ExpiresAt: &past}).State(now) != "expired" || (Key{ExpiresAt: &future}).State(now) != "active" {
		t.Fatal("key state")
	}
}
