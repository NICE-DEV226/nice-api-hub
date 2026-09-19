package clip

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestSystemClipboardIsPreferred(t *testing.T) {
	var got string
	var out bytes.Buffer
	m, err := Copier{Write: func(s string) error { got = s; return nil }, Out: &out}.Copy("K7QM-2XPD")
	if err != nil || m != System || got != "K7QM-2XPD" || out.Len() != 0 {
		t.Fatalf("%v %v %q %q", m, err, got, out.String())
	}
}

func TestFallsBackToOSC52WhenThereIsNoClipboard(t *testing.T) {
	var out bytes.Buffer
	m, err := Copier{Write: func(string) error { return errors.New("no xclip") }, Out: &out}.Copy("hello")
	if err != nil || m != OSC52 {
		t.Fatalf("%v %v", m, err)
	}
	if out.String() != "\x1b]52;c;aGVsbG8=\x07" {
		t.Fatalf("%q", out.String())
	}
}

func TestNoFallbackReportsFailure(t *testing.T) {
	m, err := Copier{Write: func(string) error { return errors.New("x") }, OSC52Off: true}.Copy("x")
	if err == nil || m != None {
		t.Fatalf("%v %v", m, err)
	}
}

func TestHugePayloadsAreTruncatedNotRejected(t *testing.T) {
	if n := len(OSC52Sequence(strings.Repeat("a", 500_000))); n > 110_000 {
		t.Fatalf("payload too large: %d", n)
	}
}
