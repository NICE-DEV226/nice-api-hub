package dl

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"video.mp4", "video.mp4"},
		{"../../etc/passwd", "passwd"},
		{`..\..\Windows\evil.exe`, "evil.exe"},
		{"/abs/path/clip.mp4", "clip.mp4"},
		{`What? A "great" video: part 1 | 2*.mp4`, `What_ A _great_ video_ part 1 _ 2_.mp4`},
		{"con.mp4", "_con.mp4"},
		{"NUL", "_NUL"},
		{"lpt3.txt", "_lpt3.txt"},
		{"comfort.mp4", "comfort.mp4"},
		{"name. . ", "name"},
		{"tab\there\x00nul.mp4", "tabherenul.mp4"},
		{"evil‮gnp.exe", "evilgnp.exe"}, // bidi override removed
		{"", "download"},
		{"..", "download"},
		{".hidden", ".hidden"},
		{"héllo wörld 🎬.mp4", "héllo wörld 🎬.mp4"},
	}
	for _, c := range cases {
		if got := SafeName(c.in, ""); got != c.want {
			t.Errorf("SafeName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if got := SafeName("???", "fallback.mp4"); got != "___" {
		t.Errorf("only illegal characters stay a (harmless) name: %q", got)
	}
	if got := SafeName("", "fallback.mp4"); got != "fallback.mp4" {
		t.Errorf("fallback: %q", got)
	}
}

func TestSafeNameLimitsLengthWithoutBreakingUTF8OrTheExtension(t *testing.T) {
	long := strings.Repeat("é", 300) + ".mp4"
	got := SafeName(long, "")
	if len(got) > 150 || !strings.HasSuffix(got, ".mp4") {
		t.Fatalf("%d bytes: %q", len(got), got)
	}
	for _, r := range got {
		if r == '�' {
			t.Fatal("cut in the middle of a rune")
		}
	}
}

func TestUniqueNumbersLikeABrowser(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "clip.mp4")
	if Unique(p) != p {
		t.Fatal("free name is kept")
	}
	os.WriteFile(p, nil, 0o644)
	if got := Unique(p); got != filepath.Join(dir, "clip (2).mp4") {
		t.Fatal(got)
	}
	os.WriteFile(filepath.Join(dir, "clip (2).mp4"), nil, 0o644)
	if got := Unique(p); got != filepath.Join(dir, "clip (3).mp4") {
		t.Fatal(got)
	}
}

func TestResolvePathNeverEscapesTheDestination(t *testing.T) {
	dir := t.TempDir()
	got := ResolvePath(dir, "../../../evil.sh", "x")
	if filepath.Dir(got) != dir {
		t.Fatalf("escaped: %s", got)
	}
}
