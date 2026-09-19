package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Problem is an RFC 9457 problem document returned by the gateway. It is also an error.
type Problem struct {
	Type       string         `json:"type"`
	Title      string         `json:"title"`
	Status     int            `json:"status"`
	Code       string         `json:"code"`
	Detail     string         `json:"detail"`
	RequestID  string         `json:"requestId"`
	RetryAfter time.Duration  `json:"-"`
	Extra      map[string]any `json:"-"`
}

func (p *Problem) Error() string {
	msg := p.Detail
	if msg == "" {
		msg = p.Title
	}
	return fmt.Sprintf("%s: %s", p.Code, msg)
}

// Hint gives an actionable suggestion for the most common failures.
func (p *Problem) Hint() string {
	switch p.Code {
	case "unauthorized":
		return "Check your key, or run `nah login`."
	case "rate_limited", "quota_exceeded", "too_many_jobs", "overloaded":
		if p.RetryAfter > 0 {
			return "Retry in " + p.RetryAfter.Round(time.Second).String() + "."
		}
		return "Retry shortly."
	case "unsupported_platform":
		return "See the supported platforms with `nah status`."
	case "content_unavailable":
		return "The media is private, removed, or has no downloadable media."
	case "upstream_unavailable":
		return "Every upstream provider failed; try again later."
	case "platform_not_allowed":
		return "Your plan or key does not include this platform."
	}
	return ""
}

// IsCode reports whether err is a gateway problem with the given code.
func IsCode(err error, code string) bool {
	var p *Problem
	return errors.As(err, &p) && p.Code == code
}

// ErrNotConfigured is returned when a credential needed for a call is missing.
type ErrNotConfigured struct{ What string }

func (e *ErrNotConfigured) Error() string {
	if e.What == "An API key" {
		return e.What + " is not configured: this computer has no account yet. Run `nah register` to create one (or `nah login` if you already have a key)."
	}
	return e.What + " is not configured. Run `nah login` (or set the matching NAH_* environment variable)."
}

type authKind int

const (
	authNone authKind = iota
	authAPIKey
	authAdmin
)

// Client talks to one gateway.
type Client struct {
	BaseURL    string
	APIKey     string
	AdminToken string
	UserAgent  string
	HTTP       *http.Client
	// streaming has no overall timeout: downloads are bounded by the caller's context.
	streaming *http.Client
}

// New builds a client. baseURL must be absolute (http or https).
func New(baseURL, apiKey, adminToken string) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("invalid gateway URL %q (expected http(s)://host[:port])", baseURL)
	}
	return &Client{
		BaseURL:    u.String(),
		APIKey:     apiKey,
		AdminToken: adminToken,
		UserAgent:  "nah-cli",
		HTTP:       &http.Client{Timeout: 90 * time.Second},
		streaming:  &http.Client{},
	}, nil
}

func (c *Client) newRequest(ctx context.Context, method, p string, q url.Values, body any, auth authKind) (*http.Request, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	u := c.BaseURL + p
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.UserAgent)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	switch auth {
	case authAPIKey:
		if c.APIKey == "" {
			return nil, &ErrNotConfigured{What: "An API key"}
		}
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	case authAdmin:
		if c.AdminToken == "" {
			return nil, &ErrNotConfigured{What: "The admin token"}
		}
		req.Header.Set("Authorization", "Bearer "+c.AdminToken)
	}
	return req, nil
}

func (c *Client) unreachable(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return fmt.Errorf("cannot reach the gateway at %s: %w", c.BaseURL, err)
}

func parseProblem(res *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	p := &Problem{Status: res.StatusCode}
	if err := json.Unmarshal(raw, p); err != nil || p.Code == "" {
		p.Code = "http_" + strconv.Itoa(res.StatusCode)
		p.Detail = strings.TrimSpace(string(raw))
		if len(p.Detail) > 200 || p.Detail == "" {
			p.Detail = http.StatusText(res.StatusCode)
		}
	}
	var extra map[string]any
	if json.Unmarshal(raw, &extra) == nil {
		for _, k := range []string{"type", "title", "status", "code", "detail", "requestId"} {
			delete(extra, k)
		}
		if len(extra) > 0 {
			p.Extra = extra
		}
	}
	if p.RequestID == "" {
		p.RequestID = res.Header.Get("X-Request-Id")
	}
	if s := res.Header.Get("Retry-After"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			p.RetryAfter = time.Duration(n) * time.Second
		}
	}
	return p
}

// call performs a request and decodes the JSON body into out (which may be nil).
func (c *Client) call(ctx context.Context, method, p string, q url.Values, body any, auth authKind, out any) error {
	req, err := c.newRequest(ctx, method, p, q, body, auth)
	if err != nil {
		return err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return c.unreachable(err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return parseProblem(res)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, res.Body)
		return nil
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("unexpected response from the gateway: %w", err)
	}
	return nil
}

type envelope[T any] struct {
	Data T `json:"data"`
}

func get[T any](ctx context.Context, c *Client, p string, q url.Values, auth authKind) (T, error) {
	var env envelope[T]
	err := c.call(ctx, http.MethodGet, p, q, nil, auth, &env)
	return env.Data, err
}

func send[T any](ctx context.Context, c *Client, method, p string, body any, auth authKind) (T, error) {
	var env envelope[T]
	err := c.call(ctx, method, p, nil, body, auth, &env)
	return env.Data, err
}

// ---- public ----------------------------------------------------------------------

// Ready reports the gateway's readiness. A 503 is a valid answer, not an error.
func (c *Client) Ready(ctx context.Context) (Readiness, error) {
	var r Readiness
	req, err := c.newRequest(ctx, http.MethodGet, "/readyz", nil, nil, authNone)
	if err != nil {
		return r, err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return r, c.unreachable(err)
	}
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		return r, fmt.Errorf("unexpected /readyz answer (HTTP %d)", res.StatusCode)
	}
	return r, nil
}

// Platforms lists supported platforms and their live status.
func (c *Client) Platforms(ctx context.Context) ([]PlatformStatus, error) {
	return get[[]PlatformStatus](ctx, c, "/v1/platforms", nil, authNone)
}

// ---- customer --------------------------------------------------------------------

// Media resolves a URL.
func (c *Client) Media(ctx context.Context, mediaURL string) (*MediaResult, error) {
	var r MediaResult
	if err := c.call(ctx, http.MethodGet, "/v1/media", url.Values{"url": {mediaURL}}, nil, authAPIKey, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// Account returns the caller's account.
func (c *Client) Account(ctx context.Context) (AccountInfo, error) {
	return get[AccountInfo](ctx, c, "/v1/account", nil, authAPIKey)
}

// Usage returns the caller's plan and consumption over the last days.
func (c *Client) Usage(ctx context.Context, days int) (Usage, error) {
	return get[Usage](ctx, c, "/v1/usage", url.Values{"days": {strconv.Itoa(days)}}, authAPIKey)
}

// SubmitJob queues an asynchronous extraction.
func (c *Client) SubmitJob(ctx context.Context, mediaURL, webhookURL, idempotencyKey string) (Job, error) {
	body := map[string]string{"url": mediaURL}
	if webhookURL != "" {
		body["webhookUrl"] = webhookURL
	}
	req, err := c.newRequest(ctx, http.MethodPost, "/v1/jobs", nil, body, authAPIKey)
	if err != nil {
		return Job{}, err
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return Job{}, c.unreachable(err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return Job{}, parseProblem(res)
	}
	var env envelope[Job]
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		return Job{}, fmt.Errorf("unexpected response from the gateway: %w", err)
	}
	return env.Data, nil
}

// Job fetches a job by id.
func (c *Client) Job(ctx context.Context, id string) (Job, error) {
	return get[Job](ctx, c, "/v1/jobs/"+url.PathEscape(id), nil, authAPIKey)
}

// WaitJob polls until the job is finished, calling onUpdate after each poll.
func (c *Client) WaitJob(ctx context.Context, id string, every time.Duration, onUpdate func(Job)) (Job, error) {
	if every <= 0 {
		every = time.Second
	}
	for {
		j, err := c.Job(ctx, id)
		if err != nil {
			return j, err
		}
		if onUpdate != nil {
			onUpdate(j)
		}
		if j.Done() {
			return j, nil
		}
		select {
		case <-ctx.Done():
			return j, ctx.Err()
		case <-time.After(every):
		}
	}
}

// DownloadRequest selects what /v1/download should stream.
type DownloadRequest struct {
	URL         string
	Kind        string // video | audio
	MaxHeight   int
	AudioFormat string // original | mp3
}

// DownloadStream is an open download. The caller must Close it.
type DownloadStream struct {
	Body          io.ReadCloser
	ContentLength int64 // -1 when unknown (merged or transcoded streams)
	ContentType   string
	Filename      string
	Provider      string
}

// Close releases the connection.
func (d *DownloadStream) Close() error { return d.Body.Close() }

// Download opens a streaming download. Errors before the first byte are returned as *Problem.
func (c *Client) Download(ctx context.Context, d DownloadRequest) (*DownloadStream, error) {
	q := url.Values{"url": {d.URL}}
	if d.Kind != "" {
		q.Set("kind", d.Kind)
	}
	if d.MaxHeight > 0 {
		q.Set("maxHeight", strconv.Itoa(d.MaxHeight))
	}
	if d.AudioFormat != "" {
		q.Set("audioFormat", d.AudioFormat)
	}
	req, err := c.newRequest(ctx, http.MethodGet, "/v1/download", q, nil, authAPIKey)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "*/*")
	res, err := c.streaming.Do(req)
	if err != nil {
		return nil, c.unreachable(err)
	}
	if res.StatusCode >= 400 {
		defer res.Body.Close()
		return nil, parseProblem(res)
	}
	return &DownloadStream{
		Body:          res.Body,
		ContentLength: res.ContentLength,
		ContentType:   res.Header.Get("Content-Type"),
		Filename:      FilenameFromDisposition(res.Header.Get("Content-Disposition")),
		Provider:      res.Header.Get("X-Download-Provider"),
	}, nil
}

var (
	reExtFilename  = regexp.MustCompile(`(?i)filename\*\s*=\s*(?:[A-Za-z0-9._-]+)?'[^']*'([^;]+)`)
	reQuotedName   = regexp.MustCompile(`(?i)filename\s*=\s*"((?:[^"\\]|\\.)*)"`)
	reUnquotedName = regexp.MustCompile(`(?i)filename\s*=\s*([^;"]+)`)
)

// FilenameFromDisposition extracts a safe base name from a Content-Disposition header.
// It uses the strict parser first and falls back to a lenient one, because real-world
// servers do not always follow RFC 6266 to the letter.
func FilenameFromDisposition(h string) string {
	if h == "" {
		return ""
	}
	name := ""
	if _, params, err := mime.ParseMediaType(h); err == nil {
		name = params["filename"] // handles filename* (RFC 5987) with priority
	}
	if name == "" {
		if m := reExtFilename.FindStringSubmatch(h); m != nil {
			if s, err := url.PathUnescape(strings.TrimSpace(m[1])); err == nil {
				name = s
			}
		} else if m := reQuotedName.FindStringSubmatch(h); m != nil {
			name = m[1]
		} else if m := reUnquotedName.FindStringSubmatch(h); m != nil {
			name = strings.TrimSpace(m[1])
		}
	}
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(name)
	if name == "." || name == "/" || name == ".." || name == "" {
		return ""
	}
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
}

// ---- operator --------------------------------------------------------------------

// Plans lists plans.
func (c *Client) Plans(ctx context.Context) ([]Plan, error) {
	return get[[]Plan](ctx, c, "/admin/v1/plans", nil, authAdmin)
}

// Accounts lists accounts.
func (c *Client) Accounts(ctx context.Context, limit, offset int) ([]Account, Page, error) {
	var r struct {
		Data []Account `json:"data"`
		Meta Page      `json:"meta"`
	}
	q := url.Values{"limit": {strconv.Itoa(limit)}, "offset": {strconv.Itoa(offset)}}
	err := c.call(ctx, http.MethodGet, "/admin/v1/accounts", q, nil, authAdmin, &r)
	return r.Data, r.Meta, err
}

// GetAccount fetches one account.
func (c *Client) GetAccount(ctx context.Context, id string) (Account, error) {
	return get[Account](ctx, c, "/admin/v1/accounts/"+url.PathEscape(id), nil, authAdmin)
}

// CreateAccount creates an account.
func (c *Client) CreateAccount(ctx context.Context, name, planID, email string) (Account, error) {
	body := map[string]any{"name": name, "planId": planID}
	if email != "" {
		body["contactEmail"] = email
	}
	return send[Account](ctx, c, http.MethodPost, "/admin/v1/accounts", body, authAdmin)
}

// UpdateAccount changes an account's name, plan or status (empty values are left unchanged).
func (c *Client) UpdateAccount(ctx context.Context, id, name, planID, status string) (Account, error) {
	body := map[string]any{}
	if name != "" {
		body["name"] = name
	}
	if planID != "" {
		body["planId"] = planID
	}
	if status != "" {
		body["status"] = status
	}
	return send[Account](ctx, c, http.MethodPatch, "/admin/v1/accounts/"+url.PathEscape(id), body, authAdmin)
}

// Keys lists an account's keys.
func (c *Client) Keys(ctx context.Context, accountID string) ([]Key, error) {
	return get[[]Key](ctx, c, "/admin/v1/accounts/"+url.PathEscape(accountID)+"/keys", nil, authAdmin)
}

// CreateKey issues a key. The returned Key.Secret is shown exactly once.
func (c *Client) CreateKey(ctx context.Context, accountID, label, env string, platforms []string) (Key, error) {
	body := map[string]any{"label": label}
	if env != "" {
		body["environment"] = env
	}
	if len(platforms) > 0 {
		body["platforms"] = platforms
	}
	return send[Key](ctx, c, http.MethodPost, "/admin/v1/accounts/"+url.PathEscape(accountID)+"/keys", body, authAdmin)
}

// RevokeKey revokes a key immediately.
func (c *Client) RevokeKey(ctx context.Context, keyID string) (Key, error) {
	return send[Key](ctx, c, http.MethodPost, "/admin/v1/keys/"+url.PathEscape(keyID)+"/revoke", nil, authAdmin)
}

// RotateKey issues a replacement and lets the old key live for graceSeconds.
func (c *Client) RotateKey(ctx context.Context, keyID string, graceSeconds int) (Key, error) {
	return send[Key](ctx, c, http.MethodPost, "/admin/v1/keys/"+url.PathEscape(keyID)+"/rotate", map[string]int{"graceSeconds": graceSeconds}, authAdmin)
}

// AccountUsage returns an account's usage over the last days (operator view).
func (c *Client) AccountUsage(ctx context.Context, accountID string, days int) ([]UsageRow, error) {
	return get[[]UsageRow](ctx, c, "/admin/v1/accounts/"+url.PathEscape(accountID)+"/usage", url.Values{"days": {strconv.Itoa(days)}}, authAdmin)
}

// RotateWebhookSecret issues a new webhook secret for an account.
func (c *Client) RotateWebhookSecret(ctx context.Context, accountID string) (Account, error) {
	return send[Account](ctx, c, http.MethodPost, "/admin/v1/accounts/"+url.PathEscape(accountID)+"/webhook-secret/rotate", nil, authAdmin)
}
