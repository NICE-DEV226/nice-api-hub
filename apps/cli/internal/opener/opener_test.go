package opener

import (
	"reflect"
	"testing"
)

func TestCommandPerPlatform(t *testing.T) {
	cases := []struct {
		goos, path string
		reveal     bool
		name       string
		args       []string
	}{
		{"linux", "/home/a/Downloads/v.mp4", false, "xdg-open", []string{"/home/a/Downloads/v.mp4"}},
		{"linux", "/home/a/Downloads/v.mp4", true, "xdg-open", []string{"/home/a/Downloads"}},
		{"darwin", "/Users/a/Downloads/v.mp4", false, "open", []string{"/Users/a/Downloads/v.mp4"}},
		{"darwin", "/Users/a/Downloads/v.mp4", true, "open", []string{"-R", "/Users/a/Downloads/v.mp4"}},
		{"windows", `C:\Users\a\Downloads\v.mp4`, false, "rundll32", []string{"url.dll,FileProtocolHandler", `C:\Users\a\Downloads\v.mp4`}},
		{"windows", `C:\Users\a\My Videos\v.mp4`, true, "explorer", []string{`/select,C:\Users\a\My Videos\v.mp4`}},
	}
	for _, c := range cases {
		name, args := Command(c.goos, c.path, c.reveal)
		if name != c.name || !reflect.DeepEqual(args, c.args) {
			t.Errorf("%s reveal=%v: %s %q", c.goos, c.reveal, name, args)
		}
	}
}

func TestEmptyPathIsRejected(t *testing.T) {
	if Open("") == nil {
		t.Fatal("must refuse")
	}
}

func TestNeverOpensProgramsDownloadedFromTheInternet(t *testing.T) {
	for _, p := range []string{"/tmp/clip.exe", "/tmp/CLIP.BAT", `C:\x\a.Ps1`, "/tmp/run.sh", "/tmp/x.desktop", "/tmp/x.AppImage"} {
		if err := Open(p); err != ErrRunnable {
			t.Errorf("%s: %v", p, err)
		}
	}
}
