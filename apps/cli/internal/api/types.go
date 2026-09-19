// Package api is a typed client for the NICE-API'HUB gateway (customer and operator APIs).
package api

import "time"

// Variant is one downloadable rendition of a media item.
type Variant struct {
	Kind        string            `json:"kind"`
	URL         string            `json:"url"`
	Label       string            `json:"label,omitempty"`
	Quality     string            `json:"quality,omitempty"`
	Width       int               `json:"width,omitempty"`
	Height      int               `json:"height,omitempty"`
	Ext         string            `json:"ext,omitempty"`
	Mime        string            `json:"mime,omitempty"`
	HasAudio    *bool             `json:"hasAudio,omitempty"`
	Protocol    string            `json:"protocol,omitempty"`
	ID          string            `json:"id,omitempty"`
	Codec       string            `json:"codec,omitempty"`
	FPS         float64           `json:"fps,omitempty"`
	BitrateKbps float64           `json:"bitrateKbps,omitempty"`
	SizeBytes   int64             `json:"sizeBytes,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
}

// Media is the unified result of resolving a URL.
type Media struct {
	Platform        string    `json:"platform"`
	SourceURL       string    `json:"sourceUrl"`
	Title           *string   `json:"title"`
	Author          *string   `json:"author"`
	Thumbnail       *string   `json:"thumbnail"`
	DurationSeconds *float64  `json:"durationSeconds"`
	Variants        []Variant `json:"variants"`
	Provider        string    `json:"provider"`
	FetchedAt       time.Time `json:"fetchedAt"`
}

// MediaMeta is the per-request metadata returned next to a Media.
type MediaMeta struct {
	RequestID string `json:"requestId"`
	Cached    bool   `json:"cached"`
	TookMs    int    `json:"tookMs"`
}

// MediaResult bundles a Media with its request metadata.
type MediaResult struct {
	Data Media     `json:"data"`
	Meta MediaMeta `json:"meta"`
}

// PlatformStatus is the public availability of one platform.
type PlatformStatus struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"` // operational | degraded | down | unknown
}

// Readiness is the answer of /readyz.
type Readiness struct {
	Status string          `json:"status"`
	Checks map[string]bool `json:"checks"`
}

// Limits are the plan limits applied to an account.
type Limits struct {
	RPS        float64 `json:"rps"`
	Burst      int     `json:"burst"`
	DailyQuota *int64  `json:"dailyQuota"`
}

// AccountInfo is what a customer sees about their own account.
type AccountInfo struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Plan          string   `json:"plan"`
	Limits        Limits   `json:"limits"`
	Platforms     []string `json:"platforms"`
	WebhookSecret string   `json:"webhookSecret"`
}

// UsageRow is one day/platform line of usage.
type UsageRow struct {
	Day         string `json:"day"`
	Platform    string `json:"platform"`
	Requests    int64  `json:"requests"`
	Errors      int64  `json:"errors"`
	CacheHits   int64  `json:"cache_hits"`
	RateLimited int64  `json:"rate_limited"`
}

// Usage is a customer's plan and recent consumption.
type Usage struct {
	Plan      string     `json:"plan"`
	Limits    Limits     `json:"limits"`
	Platforms []string   `json:"platforms"`
	Usage     []UsageRow `json:"usage"`
}

// JobError describes why a job failed.
type JobError struct {
	Status int    `json:"status"`
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

// JobWebhook is the delivery state of a job's webhook.
type JobWebhook struct {
	URL           string `json:"url"`
	Status        string `json:"status"`
	Attempts      int    `json:"attempts"`
	NextAttemptAt string `json:"nextAttemptAt,omitempty"`
	LastError     string `json:"lastError,omitempty"`
}

// Job is an asynchronous extraction.
type Job struct {
	ID         string      `json:"id"`
	Status     string      `json:"status"` // queued | running | succeeded | failed
	URL        string      `json:"url"`
	Platform   string      `json:"platform"`
	CreatedAt  string      `json:"createdAt"`
	StartedAt  string      `json:"startedAt,omitempty"`
	FinishedAt string      `json:"finishedAt,omitempty"`
	Result     *Media      `json:"result,omitempty"`
	Error      *JobError   `json:"error,omitempty"`
	Webhook    *JobWebhook `json:"webhook,omitempty"`
}

// Done reports whether the job reached a final state.
func (j Job) Done() bool { return j.Status == "succeeded" || j.Status == "failed" }

// Plan is a rate/quota plan (operator API).
type Plan struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	RPS        float64  `json:"rps"`
	Burst      int      `json:"burst"`
	DailyQuota *int64   `json:"dailyQuota"`
	MaxKeys    int      `json:"maxKeys"`
	Platforms  []string `json:"platforms"`
}

// Account is a customer account (operator API).
type Account struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	ContactEmail  *string `json:"contactEmail"`
	PlanID        string  `json:"planId"`
	Status        string  `json:"status"` // active | suspended
	CreatedAt     string  `json:"createdAt"`
	WebhookSecret string  `json:"webhookSecret"`
}

// Key describes an API key. The secret itself is only present in a creation response.
type Key struct {
	ID          string   `json:"id"`
	AccountID   string   `json:"accountId"`
	Label       string   `json:"label"`
	Prefix      string   `json:"prefix"`
	Environment string   `json:"environment"`
	Platforms   []string `json:"platforms"`
	CreatedAt   string   `json:"createdAt"`
	ExpiresAt   *string  `json:"expiresAt"`
	RevokedAt   *string  `json:"revokedAt"`
	LastUsedAt  *string  `json:"lastUsedAt"`
	Secret      string   `json:"key,omitempty"`
}

// State summarises whether a key can still be used.
func (k Key) State(now time.Time) string {
	if k.RevokedAt != nil {
		return "revoked"
	}
	if k.ExpiresAt != nil {
		if t, err := time.Parse(time.RFC3339, *k.ExpiresAt); err == nil && !t.After(now) {
			return "expired"
		}
	}
	return "active"
}

// Page is pagination metadata of list endpoints.
type Page struct {
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}
