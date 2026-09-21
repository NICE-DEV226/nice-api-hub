package ui

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

var sgrSeq = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// BGSeq returns the escape sequence that sets bg as the background, or "" when the terminal has no colour.
func BGSeq(bg lipgloss.AdaptiveColor) string {
	hex := bg.Light
	if lipgloss.HasDarkBackground() {
		hex = bg.Dark
	}
	c := lipgloss.ColorProfile().Color(hex)
	if c == nil || c.Sequence(true) == "" {
		return ""
	}
	return "\x1b[" + c.Sequence(true) + "m"
}

// EnsureBG makes every visible character of s carry a background: text that has none gets bg.
//
// Why it exists: widgets we do not control (the text input) pad with plain spaces and reset the style after each
// segment, which punches holes of the terminal's own colour into a filled area. Text that already has a background,
// or is drawn in reverse video (a cursor), is left alone.
func EnsureBG(s string, bg lipgloss.AdaptiveColor) string {
	seq := BGSeq(bg)
	if seq == "" {
		return s
	}
	var out strings.Builder
	hasBG := false
	for len(s) > 0 {
		text, esc, rest := s, "", ""
		if loc := sgrSeq.FindStringIndex(s); loc != nil {
			text, esc, rest = s[:loc[0]], s[loc[0]:loc[1]], s[loc[1]:]
		}
		if text != "" {
			if hasBG {
				out.WriteString(text)
			} else {
				out.WriteString(seq + text + "\x1b[49m") // 49 resets only the background
			}
		}
		if esc != "" {
			out.WriteString(esc)
			hasBG = nextBG(hasBG, esc)
		}
		s = rest
	}
	return out.String()
}

// BareText returns the visible characters of s that are drawn with no background at all. A filled area must give "".
// It is a diagnostic used by tests.
func BareText(s string) string {
	var out strings.Builder
	has := false
	for len(s) > 0 {
		text, esc, rest := s, "", ""
		if loc := sgrSeq.FindStringIndex(s); loc != nil {
			text, esc, rest = s[:loc[0]], s[loc[0]:loc[1]], s[loc[1]:]
		}
		if !has {
			out.WriteString(text)
		}
		if esc != "" {
			has = nextBG(has, esc)
		}
		s = rest
	}
	return out.String()
}

// nextBG tells whether a background (or reverse video) is active after the escape sequence esc.
func nextBG(cur bool, esc string) bool {
	body := strings.TrimSuffix(strings.TrimPrefix(esc, "\x1b["), "m")
	if body == "" {
		return false // ESC[m is a reset
	}
	params := strings.Split(body, ";")
	for i := 0; i < len(params); i++ {
		n, _ := strconv.Atoi(params[i])
		switch {
		case n == 0 || n == 49 || n == 27:
			cur = false
		case n == 7 || (n >= 40 && n <= 47) || (n >= 100 && n <= 107):
			cur = true
		case n == 48 || n == 38: // extended colour: skip its arguments so they are not read as attributes
			if i+1 < len(params) {
				if params[i+1] == "2" {
					i += 4
				} else {
					i += 2
				}
			}
			if n == 48 {
				cur = true
			}
		}
	}
	return cur
}
