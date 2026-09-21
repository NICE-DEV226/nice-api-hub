package cmd

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/update"
)

// fakeGitHub serves a release list and the files of each release, like the real one.
type fakeGitHub struct {
	*httptest.Server
	mu       sync.Mutex
	releases []map[string]any
	files    map[string][]byte
	hits     []string
}

func archiveOf(version, program string) (name string, data []byte) {
	name = update.ArchiveName(version, runtime.GOOS, runtime.GOARCH)
	dir := "nah_" + version + "_" + runtime.GOOS + "_" + runtime.GOARCH + "/"
	if runtime.GOOS == "windows" {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		w, _ := zw.Create(dir + "nah.exe")
		w.Write([]byte(program))
		zw.Close()
		return name, buf.Bytes()
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	tw.WriteHeader(&tar.Header{Name: dir + "nah", Typeflag: tar.TypeReg, Mode: 0o755, Size: int64(len(program))})
	tw.Write([]byte(program))
	tw.Close()
	gz.Close()
	return name, buf.Bytes()
}

func newFakeGitHub(t *testing.T) *fakeGitHub {
	g := &fakeGitHub{files: map[string][]byte{}}
	g.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		defer g.mu.Unlock()
		g.hits = append(g.hits, r.URL.Path)
		if r.URL.Path == "/releases" {
			json.NewEncoder(w).Encode(g.releases)
			return
		}
		if b, ok := g.files[strings.TrimPrefix(r.URL.Path, "/dl/")]; ok {
			w.Write(b)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(g.Close)
	return g
}

// publish adds a release whose archive holds `program`; tamper serves a different archive than the one the checksums describe.
func (g *fakeGitHub) publish(version, program string, pre, tamper bool) {
	name, data := archiveOf(version, program)
	sum := sha256.Sum256(data)
	served := data
	if tamper {
		served = append(append([]byte{}, data...), 'X')
	}
	g.files[version+"/"+name] = served
	g.files[version+"/SHA256SUMS"] = []byte(hex.EncodeToString(sum[:]) + "  " + name + "\n")
	g.releases = append(g.releases, map[string]any{
		"tag_name": "cli/v" + version, "draft": false, "prerelease": pre, "html_url": "https://example.test/releases/cli/v" + version,
		"assets": []map[string]any{
			{"name": name, "browser_download_url": g.URL + "/dl/" + version + "/" + name, "size": len(served)},
			{"name": "SHA256SUMS", "browser_download_url": g.URL + "/dl/" + version + "/SHA256SUMS", "size": 100},
		},
	})
}

type updRun struct {
	out, err string
	code     int
	exe      string
}

func runUpdate(t *testing.T, g *fakeGitHub, version string, interactive bool, args ...string) updRun {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(dir, "nah")
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	if err := os.WriteFile(exe, []byte("OLD-PROGRAM"), 0o755); err != nil {
		t.Fatal(err)
	}
	return runUpdateAt(t, g, version, interactive, exe, args...)
}

func runUpdateAt(t *testing.T, g *fakeGitHub, version string, interactive bool, exe string, args ...string) updRun {
	t.Helper()
	var out, errb bytes.Buffer
	env := Env{
		Out: &out, Err: &errb, In: strings.NewReader(""),
		Getenv: func(k string) string {
			if k == "NAH_UPDATE_API" {
				return g.URL + "/releases"
			}
			return ""
		},
		ConfigPath:  filepath.Join(t.TempDir(), "config.json"),
		Prompt:      &fakePrompt{confirm: true},
		Interactive: interactive,
		Now:         func() time.Time { return time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC) },
		Version:     version,
		Executable:  func() (string, error) { return exe, nil },
	}
	root := NewRoot(env)
	root.SetArgs(append([]string{"update"}, args...))
	err := root.ExecuteContext(context.Background())
	jsonMode := false
	for _, a := range args {
		if a == "--json" {
			jsonMode = true
		}
	}
	code := RenderError(env, err, jsonMode)
	return updRun{out.String(), errb.String(), code, exe}
}

func content(t *testing.T, path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestUpdateReplacesTheProgramWithTheLatestRelease(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.1.0", "PROGRAM-0.1.0", false, false)
	g.publish("0.2.0", "PROGRAM-0.2.0", false, false)
	r := runUpdate(t, g, "0.1.0", false, "--yes")
	if r.code != 0 || !strings.Contains(r.out, "nah is now 0.2.0") || !strings.Contains(r.out, "was 0.1.0") {
		t.Fatalf("%d\n%s\n%s", r.code, r.out, r.err)
	}
	if got := content(t, r.exe); got != "PROGRAM-0.2.0" {
		t.Fatalf("the program was not replaced: %q", got)
	}
	if !strings.Contains(r.err, "checksum verified") {
		t.Fatal("the checksum step must be visible")
	}
	if !strings.Contains(r.out, "https://example.test/releases/cli/v0.2.0") {
		t.Fatal("it points at what changed")
	}
}

func TestUpdateSaysWhenThereIsNothingNewAndChangesNothing(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.2.0", "PROGRAM-0.2.0", false, false)
	r := runUpdate(t, g, "0.2.0", false, "--yes")
	if r.code != 0 || !strings.Contains(r.out, "up to date") || content(t, r.exe) != "OLD-PROGRAM" {
		t.Fatalf("%d %s | %s", r.code, r.out, content(t, r.exe))
	}
	for _, h := range g.hits {
		if strings.HasPrefix(h, "/dl/") {
			t.Fatalf("nothing must be downloaded when already current: %v", g.hits)
		}
	}
}

func TestCheckOnlyLooks(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.2.0", "PROGRAM-0.2.0", false, false)
	r := runUpdate(t, g, "0.1.0", false, "--check")
	if r.code != 0 || !strings.Contains(r.out, "Update available") || !strings.Contains(r.out, "0.2.0") || content(t, r.exe) != "OLD-PROGRAM" {
		t.Fatalf("%d %s", r.code, r.out)
	}
	j := runUpdate(t, g, "0.1.0", false, "--check", "--json")
	var got struct {
		Current, Latest string
		UpdateAvailable bool
	}
	if err := json.Unmarshal([]byte(j.out), &got); err != nil || got.Current != "0.1.0" || got.Latest != "0.2.0" || !got.UpdateAvailable {
		t.Fatalf("%v %s", err, j.out)
	}
	up := runUpdate(t, g, "0.2.0", false, "--check", "--json")
	json.Unmarshal([]byte(up.out), &got)
	if got.UpdateAvailable {
		t.Fatal("no update when current")
	}
}

func TestATamperedDownloadIsRefusedAndTheOldProgramStays(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.2.0", "PROGRAM-0.2.0", false, true)
	r := runUpdate(t, g, "0.1.0", false, "--yes")
	if r.code == 0 || !strings.Contains(r.err, "tampered") || !strings.Contains(r.err, "nothing was changed") {
		t.Fatalf("%d\n%s", r.code, r.err)
	}
	if content(t, r.exe) != "OLD-PROGRAM" {
		t.Fatal("a failed update must leave the working program untouched")
	}
}

func TestWithoutYesANonInteractiveUpdateRefusesToRun(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.2.0", "PROGRAM-0.2.0", false, false)
	r := runUpdate(t, g, "0.1.0", false)
	if r.code != ExitUsage || !strings.Contains(r.err, "--yes") || content(t, r.exe) != "OLD-PROGRAM" {
		t.Fatalf("%d %s", r.code, r.err)
	}
	// on a terminal it asks, and a yes goes ahead
	if r := runUpdate(t, g, "0.1.0", true); r.code != 0 || content(t, r.exe) != "PROGRAM-0.2.0" {
		t.Fatalf("%d %s", r.code, r.err)
	}
}

func TestPreReleasesAreOnlyOfferedToThoseWhoWantThem(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.2.0", "FINAL-0.2.0", false, false)
	g.publish("0.3.0-rc.1", "RC-0.3.0", true, false)

	if r := runUpdate(t, g, "0.1.0", false, "--yes"); content(t, r.exe) != "FINAL-0.2.0" {
		t.Fatalf("someone on a final release must not be moved to a pre-release: %q\n%s", content(t, r.exe), r.out)
	}
	if r := runUpdate(t, g, "0.1.0", false, "--yes", "--pre"); content(t, r.exe) != "RC-0.3.0" {
		t.Fatalf("--pre accepts it: %q", content(t, r.exe))
	}
	if r := runUpdate(t, g, "0.3.0-beta.1", false, "--yes"); content(t, r.exe) != "RC-0.3.0" {
		t.Fatalf("someone already on a pre-release hears about the next one: %q", content(t, r.exe))
	}
}

func TestFromARCToTheFinalRelease(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.1.0-rc.1", "RC", true, false)
	g.publish("0.1.0", "FINAL", false, false)
	if r := runUpdate(t, g, "0.1.0-rc.1", false, "--yes"); content(t, r.exe) != "FINAL" || !strings.Contains(r.out, "0.1.0") {
		t.Fatalf("the final release outranks its own rc: %q\n%s", content(t, r.exe), r.out)
	}
}

func TestAnExactVersionCanBeChosenIncludingAnOlderOne(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.1.0", "OLDER", false, false)
	g.publish("0.2.0", "NEWER", false, false)
	r := runUpdate(t, g, "0.2.0", false, "--version", "0.1.0", "--yes")
	if r.code != 0 || content(t, r.exe) != "OLDER" {
		t.Fatalf("%d %s | %q", r.code, r.err, content(t, r.exe))
	}
	if r := runUpdate(t, g, "0.2.0", false, "--version", "0.1.0"); r.code != ExitUsage {
		t.Fatalf("going back needs confirmation too: %d", r.code)
	}
	if r := runUpdate(t, g, "0.1.0", false, "--version", "9.9.9", "--yes"); r.code != ExitUsage || !strings.Contains(r.err, "no release 9.9.9") {
		t.Fatalf("%d %s", r.code, r.err)
	}
	if r := runUpdate(t, g, "0.2.0", false, "--version", "0.2.0", "--yes"); !strings.Contains(r.out, "already on") {
		t.Fatalf("%s", r.out)
	}
}

func TestABuildWithoutAVersionExplainsHowToUpdate(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.2.0", "NEWER", false, false)
	r := runUpdate(t, g, "dev", false, "--yes")
	if r.code != ExitUsage || !strings.Contains(r.err, "built from source") || !strings.Contains(r.err, "--force") || content(t, r.exe) != "OLD-PROGRAM" {
		t.Fatalf("%d %s", r.code, r.err)
	}
	if r := runUpdate(t, g, "dev", false, "--yes", "--force"); r.code != 0 || content(t, r.exe) != "NEWER" {
		t.Fatalf("--force installs the latest release over a source build: %d %s", r.code, r.err)
	}
}

func TestAReleaseWithoutABuildForThisSystemIsReported(t *testing.T) {
	g := newFakeGitHub(t)
	g.releases = append(g.releases, map[string]any{"tag_name": "cli/v0.2.0", "draft": false, "prerelease": false,
		"assets": []map[string]any{{"name": "nah_0.2.0_plan9_mips.tar.gz", "browser_download_url": g.URL + "/dl/x", "size": 1}}})
	r := runUpdate(t, g, "0.1.0", false, "--yes")
	if r.code == 0 || !strings.Contains(r.err, "no build for "+runtime.GOOS+"/"+runtime.GOARCH) {
		t.Fatalf("%d %s", r.code, r.err)
	}
}

func TestOnlyAppReleasesCount(t *testing.T) {
	g := newFakeGitHub(t)
	g.releases = append(g.releases, map[string]any{"tag_name": "api/v5.0.0", "draft": false, "prerelease": false, "assets": []any{}})
	r := runUpdate(t, g, "0.1.0", false, "--check")
	if r.code == 0 || !strings.Contains(r.err, "no release of nah") {
		t.Fatalf("%d %s%s", r.code, r.out, r.err)
	}
}

func TestAnUnreachableReleaseListIsAPlainError(t *testing.T) {
	g := newFakeGitHub(t)
	g.Close()
	r := runUpdate(t, g, "0.1.0", false, "--check")
	if r.code == 0 || !strings.Contains(r.err, "cannot reach") {
		t.Fatalf("%d %s", r.code, r.err)
	}
}

func TestWhenOnlyPreReleasesExistItSaysSoAndHowToUseOne(t *testing.T) {
	g := newFakeGitHub(t)
	g.publish("0.1.0-rc.1", "RC", true, false)
	r := runUpdate(t, g, "0.0.1", false, "--check")
	if r.code == 0 || !strings.Contains(r.err, "no final release yet") || !strings.Contains(r.err, "--pre") {
		t.Fatalf("%d %s", r.code, r.err)
	}
	if r := runUpdate(t, g, "0.0.1", false, "--check", "--pre"); r.code != 0 || !strings.Contains(r.out, "0.1.0-rc.1") {
		t.Fatalf("%d %s", r.code, r.out+r.err)
	}
}
