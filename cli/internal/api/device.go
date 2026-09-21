package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
)

// SignupInfo says whether accounts can be created on this gateway and what the computer must solve first.
type SignupInfo struct {
	Mode                string `json:"mode"`
	RequiresInvite      bool   `json:"requiresInvite"`
	OneAccountPerDevice bool   `json:"oneAccountPerDevice"`
	Plan                *struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Limits struct {
			RPS        float64 `json:"rps"`
			Burst      int     `json:"burst"`
			DailyQuota *int64  `json:"dailyQuota"`
			MaxKeys    int     `json:"maxKeys"`
		} `json:"limits"`
	} `json:"plan"`
	Challenge *Challenge `json:"challenge"`
}

// Open reports whether this computer may try to create an account.
func (s SignupInfo) Open() bool { return s.Mode != "closed" && s.Challenge != nil }

// Challenge is a proof-of-work puzzle: sha256(token + ":" + nonce) must start with Bits zero bits.
type Challenge struct {
	Token     string `json:"token"`
	Bits      int    `json:"bits"`
	ExpiresAt string `json:"expiresAt"`
}

// AccountBrief is the account a device key belongs to.
type AccountBrief struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Plan string `json:"plan"`
}

// Enrollment is what the gateway returns when a computer gets a key of its own. Key and RecoveryKey are
// shown exactly once.
type Enrollment struct {
	Account     AccountBrief `json:"account"`
	Key         string       `json:"key"`
	KeyID       string       `json:"keyId"`
	RecoveryKey string       `json:"recoveryKey,omitempty"`
}

// RegisterRequest creates an account for this computer.
type RegisterRequest struct {
	DeviceName string `json:"deviceName"`
	DeviceHash string `json:"deviceHash"`
	Challenge  string `json:"challenge"`
	Nonce      string `json:"nonce"`
	Name       string `json:"name,omitempty"`
	InviteCode string `json:"inviteCode,omitempty"`
}

// SignupInfo fetches the signup policy and a fresh challenge (public).
func (c *Client) SignupInfo(ctx context.Context) (SignupInfo, error) {
	return get[SignupInfo](ctx, c, "/v1/register", nil, authNone)
}

// Register creates an account for this computer (public; needs a solved challenge).
func (c *Client) Register(ctx context.Context, r RegisterRequest) (Enrollment, error) {
	return send[Enrollment](ctx, c, http.MethodPost, "/v1/register", r, authNone)
}

// RedeemLink adds this computer to an existing account with a one-time code (public).
func (c *Client) RedeemLink(ctx context.Context, code, deviceName, deviceHash string) (Enrollment, error) {
	return send[Enrollment](ctx, c, http.MethodPost, "/v1/link/redeem", map[string]string{"code": code, "deviceName": deviceName, "deviceHash": deviceHash}, authNone)
}

// LinkCode is a one-time code for adding another computer.
type LinkCode struct {
	Code       string `json:"code"`
	TTLSeconds int    `json:"ttlSeconds"`
	ExpiresAt  string `json:"expiresAt"`
}

// NewLinkCode asks for a code to add another computer to this account.
func (c *Client) NewLinkCode(ctx context.Context) (LinkCode, error) {
	return send[LinkCode](ctx, c, http.MethodPost, "/v1/link", nil, authAPIKey)
}

// Recover exchanges the recovery key (set as the client's API key) for a key for this computer.
func (c *Client) Recover(ctx context.Context, deviceName, deviceHash string) (Enrollment, error) {
	return send[Enrollment](ctx, c, http.MethodPost, "/v1/recover", map[string]string{"deviceName": deviceName, "deviceHash": deviceHash}, authAPIKey)
}

// MyKeys lists the caller's own keys (devices).
func (c *Client) MyKeys(ctx context.Context) ([]Key, error) {
	return get[[]Key](ctx, c, "/v1/keys", nil, authAPIKey)
}

// CreateMyKey issues another key for the caller's account. The secret is shown once.
func (c *Client) CreateMyKey(ctx context.Context, label string, scopes []string) (Key, error) {
	body := map[string]any{"label": label}
	if len(scopes) > 0 {
		body["scopes"] = scopes
	}
	return send[Key](ctx, c, http.MethodPost, "/v1/keys", body, authAPIKey)
}

// RevokeMyKey revokes one of the caller's own keys.
func (c *Client) RevokeMyKey(ctx context.Context, keyID string) (Key, error) {
	return send[Key](ctx, c, http.MethodPost, "/v1/keys/"+url.PathEscape(keyID)+"/revoke", nil, authAPIKey)
}

// RotateMyKey replaces one of the caller's own keys; the old one lives on for graceSeconds.
func (c *Client) RotateMyKey(ctx context.Context, keyID string, graceSeconds int) (Key, error) {
	return send[Key](ctx, c, http.MethodPost, "/v1/keys/"+url.PathEscape(keyID)+"/rotate", map[string]int{"graceSeconds": graceSeconds}, authAPIKey)
}

// maxThumbnail bounds what is read from the gateway: it never sends more than 4 MiB.
const maxThumbnail = 5 << 20

// Thumbnail asks the gateway for the preview image of a media it just resolved (`thumbnail` in a /v1/media answer).
// The gateway fetches it, so the CDN never sees this computer. It returns the encoded image (JPEG, PNG, WebP or GIF).
func (c *Client) Thumbnail(ctx context.Context, imageURL string) ([]byte, error) {
	req, err := c.newRequest(ctx, http.MethodGet, "/v1/thumbnail", url.Values{"url": {imageURL}}, nil, authAPIKey)
	if err != nil {
		return nil, err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, c.unreachable(err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return nil, parseProblem(res)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxThumbnail+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxThumbnail {
		return nil, errors.New("thumbnail is larger than expected")
	}
	return body, nil
}
