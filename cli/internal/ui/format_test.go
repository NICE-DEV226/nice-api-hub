package ui

import (
	"testing"
	"time"
)

func TestBytes(t *testing.T) {
	for in, want := range map[int64]string{0: "0 B", 1023: "1023 B", 1024: "1.0 KB", 1536: "1.5 KB", 28510435: "27.2 MB", 1 << 30: "1.0 GB"} {
		if got := Bytes(in); got != want {
			t.Errorf("Bytes(%d)=%q want %q", in, got, want)
		}
	}
}

func TestDuration(t *testing.T) {
	for in, want := range map[float64]string{0: "0:00", 32: "0:32", 634.66: "10:35", 3661: "1:01:01", -5: "0:00"} {
		if got := Duration(in); got != want {
			t.Errorf("Duration(%v)=%q want %q", in, got, want)
		}
	}
}

func TestAgo(t *testing.T) {
	now := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	for d, want := range map[time.Duration]string{10 * time.Second: "just now", 5 * time.Minute: "5m ago", 3 * time.Hour: "3h ago", 72 * time.Hour: "3d ago"} {
		if got := Ago(now.Add(-d), now); got != want {
			t.Errorf("%v -> %q want %q", d, got, want)
		}
	}
	if AgoString(nil, now) != "never" {
		t.Error("nil -> never")
	}
	bad := "garbage"
	if AgoString(&bad, now) != "garbage" {
		t.Error("unparsable values are shown as-is")
	}
}

func TestTruncateIsRuneSafe(t *testing.T) {
	if Truncate("hello", 10) != "hello" || Truncate("hello world", 6) != "hello…" || Truncate("été🎬été", 4) != "été…" {
		t.Fatalf("%q", Truncate("été🎬été", 4))
	}
	if Truncate("abc", 0) != "abc" || Truncate("abc", 1) != "…" {
		t.Fatal("edge widths")
	}
}

func TestPluralAndDeref(t *testing.T) {
	if Plural(1, "key", "keys") != "1 key" || Plural(0, "key", "keys") != "0 keys" {
		t.Fatal("plural")
	}
	e, s := "", "x"
	if Deref(nil, "-") != "-" || Deref(&e, "-") != "-" || Deref(&s, "-") != "x" {
		t.Fatal("deref")
	}
}
