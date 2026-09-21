package dl

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
)

func stream(body string, length int64, name string) *api.DownloadStream {
	return &api.DownloadStream{Body: io.NopCloser(bytes.NewReader([]byte(body))), ContentLength: length, Filename: name}
}

func TestSaveWritesAtomically(t *testing.T) {
	dir := t.TempDir()
	var last int64
	path, n, err := Save(context.Background(), stream("hello world", 11, "clip.mp4"), dir, "fallback.bin", false, func(d, tot int64) { last = d })
	if err != nil || n != 11 || filepath.Base(path) != "clip.mp4" || last != 11 {
		t.Fatalf("%q %d %v %d", path, n, err, last)
	}
	b, _ := os.ReadFile(path)
	if string(b) != "hello world" {
		t.Fatalf("content %q", b)
	}
	if _, err := os.Stat(path + ".part"); !os.IsNotExist(err) {
		t.Fatal(".part must be gone after success")
	}
}

func TestSaveRefusesToOverwriteUnlessForced(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "x.mp4")
	os.WriteFile(target, []byte("old"), 0o644)
	if _, _, err := Save(context.Background(), stream("new", 3, ""), target, "f", false, nil); !errors.Is(err, ErrExists) {
		t.Fatalf("want ErrExists, got %v", err)
	}
	if b, _ := os.ReadFile(target); string(b) != "old" {
		t.Fatal("existing file must be untouched")
	}
	if _, _, err := Save(context.Background(), stream("new", 3, ""), target, "f", true, nil); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(target); string(b) != "new" {
		t.Fatal("force should overwrite")
	}
}

func TestSaveDetectsTruncatedDownloadsAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	_, _, err := Save(context.Background(), stream("short", 100, "a.mp4"), dir, "f", false, nil)
	if err == nil {
		t.Fatal("a body shorter than Content-Length must fail")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("no partial file may remain, found %v", entries)
	}
}

type slowReader struct{ ctxDone <-chan struct{} }

func (s slowReader) Read(p []byte) (int, error) {
	select {
	case <-s.ctxDone:
		return 0, errors.New("aborted")
	case <-time.After(5 * time.Millisecond):
		p[0] = 'x'
		return 1, nil
	}
}

func TestSaveCancellationLeavesNothingBehind(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	s := &api.DownloadStream{Body: io.NopCloser(slowReader{ctx.Done()}), ContentLength: -1, Filename: "big.mp4"}
	_, _, err := Save(ctx, s, dir, "f", false, nil)
	if err == nil {
		t.Fatal("cancelled download must return an error")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("leftovers: %v", entries)
	}
}

func TestResolvePath(t *testing.T) {
	dir := t.TempDir()
	if got := ResolvePath("", "a.mp4", "f"); got != filepath.Join(".", "a.mp4") {
		t.Errorf("%q", got)
	}
	if got := ResolvePath(dir, "a.mp4", "f"); got != filepath.Join(dir, "a.mp4") {
		t.Errorf("%q", got)
	}
	if got := ResolvePath(dir, "", "fallback.bin"); got != filepath.Join(dir, "fallback.bin") {
		t.Errorf("%q", got)
	}
	if got := ResolvePath(filepath.Join(dir, "custom.mp4"), "a.mp4", "f"); got != filepath.Join(dir, "custom.mp4") {
		t.Errorf("explicit file path wins: %q", got)
	}
	if got := ResolvePath(filepath.Join(dir, "newdir")+string(os.PathSeparator), "a.mp4", "f"); got != filepath.Join(dir, "newdir", "a.mp4") {
		t.Errorf("trailing slash means directory: %q", got)
	}
}
