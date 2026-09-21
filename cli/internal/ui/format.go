// Package ui holds the shared look of the CLI: styles and human-friendly formatting.
package ui

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Bytes formats a byte count (1536 -> "1.5 KB").
func Bytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

// Duration formats seconds as m:ss or h:mm:ss.
func Duration(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	s := int(seconds + 0.5)
	h, m, sec := s/3600, (s%3600)/60, s%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, sec)
	}
	return fmt.Sprintf("%d:%02d", m, sec)
}

// Ago formats how long before now a time was ("3m ago", "2d ago").
func Ago(t, now time.Time) string {
	d := now.Sub(t)
	switch {
	case d < 0:
		return "in the future"
	case d < 45*time.Second:
		return "just now"
	case d < 90*time.Minute:
		return fmt.Sprintf("%dm ago", int(d.Minutes()+0.5))
	case d < 36*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()+0.5))
	}
	return fmt.Sprintf("%dd ago", int(d.Hours()/24+0.5))
}

// AgoString parses an RFC 3339 timestamp; "never" for nil, the raw value if unparsable.
func AgoString(ts *string, now time.Time) string {
	if ts == nil {
		return "never"
	}
	t, err := time.Parse(time.RFC3339, *ts)
	if err != nil {
		return *ts
	}
	return Ago(t, now)
}

// Truncate shortens s to at most n runes, ending with an ellipsis.
func Truncate(s string, n int) string {
	if n <= 0 || utf8.RuneCountInString(s) <= n {
		return s
	}
	if n == 1 {
		return "…"
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

// Deref returns *s, or fallback when s is nil or empty.
func Deref(s *string, fallback string) string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return fallback
	}
	return *s
}

// Plural returns "1 key" / "2 keys".
func Plural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}
