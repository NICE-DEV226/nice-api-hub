package preview

import (
	"context"
	"net"
	"net/http"
	"time"
)

// NewClient returns an HTTP client suited to fetching a thumbnail quickly.
//
// Go's built-in DNS resolver waits 5 seconds on a nameserver that does not answer before trying the next one, which
// showed up as a 6-second delay on machines whose first resolver is unreachable (the system resolver, used by curl and
// browsers, is not affected). Here each nameserver gets about a second, and IPv4/IPv6 attempts race at 100 ms.
func NewClient() *http.Client {
	resolver := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			c, err := (&net.Dialer{Timeout: time.Second}).DialContext(ctx, network, address)
			if err != nil {
				return nil, err
			}
			return shortConn{Conn: c, max: 1200 * time.Millisecond}, nil
		},
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, FallbackDelay: 100 * time.Millisecond, Resolver: resolver}
	return &http.Client{
		Timeout: 12 * time.Second,
		Transport: &http.Transport{
			DialContext:         dialer.DialContext,
			ForceAttemptHTTP2:   true,
			TLSHandshakeTimeout: 5 * time.Second,
			MaxIdleConns:        4,
			IdleConnTimeout:     30 * time.Second,
			Proxy:               http.ProxyFromEnvironment,
		},
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) >= 4 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

// shortConn caps every deadline the resolver sets, so a silent nameserver costs about a second, not five.
type shortConn struct {
	net.Conn
	max time.Duration
}

func (c shortConn) clamp(t time.Time) time.Time {
	limit := time.Now().Add(c.max)
	if t.IsZero() || t.After(limit) {
		return limit
	}
	return t
}

func (c shortConn) SetDeadline(t time.Time) error      { return c.Conn.SetDeadline(c.clamp(t)) }
func (c shortConn) SetReadDeadline(t time.Time) error  { return c.Conn.SetReadDeadline(c.clamp(t)) }
func (c shortConn) SetWriteDeadline(t time.Time) error { return c.Conn.SetWriteDeadline(c.clamp(t)) }
