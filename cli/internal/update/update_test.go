package update

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
	"sort"
	"strings"
	"testing"
)

func TestSemverPrecedence(t *testing.T) {
	// the ordering from https://semver.org, lowest first
	ordered := []string{"0.9.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"}
	for i := range ordered {
		for j := range ordered {
			a, _ := ParseVersion(ordered[i])
			b, _ := ParseVersion(ordered[j])
			want := 0
			if i < j {
				want = -1
			} else if i > j {
				want = 1
			}
			if got := Compare(a, b); got != want {
				t.Errorf("Compare(%s, %s) = %d, want %d", ordered[i], ordered[j], got, want)
			}
		}
	}
	if a, _ := ParseVersion("1.0.0+build.5"); Compare(a, mustV(t, "1.0.0")) != 0 {
		t.Error("build metadata is ignored")
	}
	if a, _ := ParseVersion("1.2.10"); Compare(a, mustV(t, "1.2.9")) != 1 {
		t.Error("numbers compare as numbers, not text")
	}
}

func mustV(t *testing.T, s string) Version {
	v, ok := ParseVersion(s)
	if !ok {
		t.Fatalf("%q", s)
	}
	return v
}

func TestParseVersionAcceptsTagsAndRejectsGarbage(t *testing.T) {
	for _, ok := range []string{"1.2.3", "v1.2.3", "cli/v1.2.3", "cli/v0.1.0-rc.1", " 1.2.3 "} {
		if _, good := ParseVersion(ok); !good {
			t.Errorf("%q should parse", ok)
		}
	}
	for _, bad := range []string{"", "dev", "1.2", "1.2.3.4", "a.b.c", "1.2.3-", "1.2.3-a..b", "01.2.3", "-1.2.3", "api/v1.0.0"} {
		if _, good := ParseVersion(bad); good {
			t.Errorf("%q must be rejected", bad)
		}
	}
	if v := mustV(t, "cli/v0.1.0-rc.1"); v.String() != "0.1.0-rc.1" || !v.IsPrerelease() {
		t.Fatal(v)
	}
}

func releasesJSON(rs ...map[string]any) string {
	b, _ := json.Marshal(rs)
	return string(b)
}

func rel(tag string, pre bool, assets ...string) map[string]any {
	var as []map[string]any
	for _, a := range assets {
		as = append(as, map[string]any{"name": a, "browser_download_url": "https://dl.example/" + a, "size": 10})
	}
	return map[string]any{"tag_name": tag, "draft": false, "prerelease": pre, "html_url": "https://example/" + tag, "assets": as}
}

func serveJSON(t *testing.T, status int, body string) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestFetchKeepsOnlyAppReleasesNewestFirst(t *testing.T) {
	draft := rel("cli/v9.9.9", false)
	draft["draft"] = true
	url := serveJSON(t, 200, releasesJSON(
		rel("api/v3.0.0", false), // another product living in the same repository
		rel("cli/v0.1.0-rc.1", true, "a.tar.gz"),
		draft,
		rel("cli/v0.2.0", false, "b.tar.gz"),
		rel("cli/vnext", false),
		rel("cli/v0.1.0", false),
	))
	rs, err := Fetch(context.Background(), http.DefaultClient, url)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, r := range rs {
		got = append(got, r.Version.String())
	}
	if strings.Join(got, ",") != "0.2.0,0.1.0,0.1.0-rc.1" {
		t.Fatalf("%v", got)
	}
	if a, ok := rs[0].Asset("b.tar.gz"); !ok || a.URL != "https://dl.example/b.tar.gz" || rs[0].Page != "https://example/cli/v0.2.0" {
		t.Fatalf("%+v", rs[0])
	}
	if l, ok := Latest(rs, false); !ok || l.Version.String() != "0.2.0" {
		t.Fatal("latest final")
	}
	onlyRC, _ := Fetch(context.Background(), http.DefaultClient, serveJSON(t, 200, releasesJSON(rel("cli/v0.1.0-rc.1", true))))
	if _, ok := Latest(onlyRC, false); ok {
		t.Fatal("no final release exists")
	}
	if l, ok := Latest(onlyRC, true); !ok || l.Version.String() != "0.1.0-rc.1" {
		t.Fatal("with pre-releases allowed the rc is the latest")
	}
	if r, ok := Find(rs, "v0.1.0"); !ok || r.Version.String() != "0.1.0" {
		t.Fatal("find exact")
	}
	if _, ok := Find(rs, "5.0.0"); ok {
		t.Fatal("unknown version")
	}
}

func TestFetchReportsProblemsPlainly(t *testing.T) {
	ctx := context.Background()
	if _, err := Fetch(ctx, http.DefaultClient, serveJSON(t, 403, `{"message":"rate limit"}`)); err == nil || !strings.Contains(err.Error(), "rate-limiting") {
		t.Fatalf("%v", err)
	}
	if _, err := Fetch(ctx, http.DefaultClient, serveJSON(t, 500, "")); err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("%v", err)
	}
	if _, err := Fetch(ctx, http.DefaultClient, serveJSON(t, 200, "<html>not json</html>")); err == nil {
		t.Fatal("garbage")
	}
	if _, err := Fetch(ctx, http.DefaultClient, "http://127.0.0.1:1/"); err == nil || !strings.Contains(err.Error(), "cannot reach") {
		t.Fatalf("%v", err)
	}
}

func TestArchiveNamesMatchTheReleasePipeline(t *testing.T) {
	cases := map[[3]string]string{
		{"0.1.0", "linux", "amd64"}:       "nah_0.1.0_linux_amd64.tar.gz",
		{"0.1.0-rc.1", "darwin", "arm64"}: "nah_0.1.0-rc.1_darwin_arm64.tar.gz",
		{"1.0.0", "windows", "arm64"}:     "nah_1.0.0_windows_arm64.zip",
	}
	for in, want := range cases {
		if got := ArchiveName(in[0], in[1], in[2]); got != want {
			t.Errorf("%v -> %s, want %s", in, got, want)
		}
	}
}

func TestChecksums(t *testing.T) {
	data := []byte("the program")
	sum := sha256.Sum256(data)
	h := hex.EncodeToString(sum[:])
	sums := []byte(strings.Join([]string{
		strings.Repeat("a", 64) + "  other.tar.gz",
		h + "  nah_1.0.0_linux_amd64.tar.gz",
		strings.ToUpper(h) + " *binary-mode.zip",
		"short  bad-line.txt",
		"",
	}, "\n"))
	if got, ok := ChecksumFor(sums, "nah_1.0.0_linux_amd64.tar.gz"); !ok || got != h {
		t.Fatalf("%q %v", got, ok)
	}
	if got, ok := ChecksumFor(sums, "binary-mode.zip"); !ok || got != h {
		t.Fatal("'*' marks binary mode and upper case is fine")
	}
	if _, ok := ChecksumFor(sums, "missing"); ok {
		t.Fatal("unlisted file")
	}
	if _, ok := ChecksumFor(sums, "bad-line.txt"); ok {
		t.Fatal("a line whose checksum is not 64 hex characters is not a checksum")
	}
	if VerifySHA256(data, h) != nil || VerifySHA256(data, strings.ToUpper(h)) != nil {
		t.Fatal("matching")
	}
	if err := VerifySHA256(append(data, '!'), h); err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("tampered: %v", err)
	}
}

func tarGz(t *testing.T, files map[string]string) []byte {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if strings.HasSuffix(n, "/") {
			tw.WriteHeader(&tar.Header{Name: n, Typeflag: tar.TypeDir, Mode: 0o755})
			continue
		}
		tw.WriteHeader(&tar.Header{Name: n, Typeflag: tar.TypeReg, Mode: 0o755, Size: int64(len(files[n]))})
		tw.Write([]byte(files[n]))
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func zipOf(t *testing.T, files map[string]string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for n, c := range files {
		w, _ := zw.Create(n)
		w.Write([]byte(c))
	}
	zw.Close()
	return buf.Bytes()
}

func TestExtractBinaryReadsOnlyTheProgram(t *testing.T) {
	tgz := tarGz(t, map[string]string{"nah_1.0.0_linux_amd64/": "", "nah_1.0.0_linux_amd64/README.md": "docs", "nah_1.0.0_linux_amd64/nah": "ELF-BINARY"})
	if b, err := ExtractBinary(tgz, "x.tar.gz"); err != nil || string(b) != "ELF-BINARY" {
		t.Fatalf("%q %v", b, err)
	}
	z := zipOf(t, map[string]string{"nah_1.0.0_windows_amd64/nah.exe": "MZ-BINARY", "nah_1.0.0_windows_amd64/README.md": "docs"})
	if b, err := ExtractBinary(z, "x.zip"); err != nil || string(b) != "MZ-BINARY" {
		t.Fatalf("%q %v", b, err)
	}
	// a path that tries to escape is harmless: nothing is ever written from the archive, and only the program's own name is read
	evil := tarGz(t, map[string]string{"../../etc/passwd": "root", "nah_1.0.0_linux_amd64/nah": "OK"})
	if b, err := ExtractBinary(evil, "x.tar.gz"); err != nil || string(b) != "OK" {
		t.Fatalf("%q %v", b, err)
	}
}

func TestExtractBinaryRefusesWhatIsNotAReleaseArchive(t *testing.T) {
	if _, err := ExtractBinary(tarGz(t, map[string]string{"readme": "x"}), "x.tar.gz"); err == nil || !strings.Contains(err.Error(), "does not contain nah") {
		t.Fatalf("%v", err)
	}
	if _, err := ExtractBinary(tarGz(t, map[string]string{"dir/nah": ""}), "x.tar.gz"); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("an empty program: %v", err)
	}
	if _, err := ExtractBinary(zipOf(t, map[string]string{"nah": "not the windows name"}), "x.zip"); err == nil {
		t.Fatal("a zip must hold nah.exe")
	}
	if _, err := ExtractBinary([]byte("not an archive"), "x.tar.gz"); err == nil {
		t.Fatal("garbage tar.gz")
	}
	if _, err := ExtractBinary([]byte("not an archive"), "x.zip"); err == nil {
		t.Fatal("garbage zip")
	}
}

func TestDownloadHonoursItsLimitAndReportsHTTPErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/small":
			w.Write([]byte("hello"))
		case "/big":
			w.Write(make([]byte, 2<<20))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	if b, err := Download(ctx, http.DefaultClient, srv.URL+"/small", 1<<20); err != nil || string(b) != "hello" {
		t.Fatalf("%q %v", b, err)
	}
	if _, err := Download(ctx, http.DefaultClient, srv.URL+"/big", 1<<20); err == nil || !strings.Contains(err.Error(), "larger") {
		t.Fatalf("%v", err)
	}
	if _, err := Download(ctx, http.DefaultClient, srv.URL+"/nope", 1<<20); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("%v", err)
	}
}

func TestReplaceExecutableSwapsTheFileAndLeavesNoTemporaries(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "nah")
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	if err := os.WriteFile(exe, []byte("OLD"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ReplaceExecutable(exe, []byte("NEW-PROGRAM")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "NEW-PROGRAM" {
		t.Fatalf("%q", b)
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(exe); st.Mode().Perm()&0o111 == 0 {
			t.Fatalf("the new program must stay executable: %v", st.Mode())
		}
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() != filepath.Base(exe) && e.Name() != filepath.Base(exe)+".old" {
			t.Fatalf("temporary file left behind: %s", e.Name())
		}
	}
	CleanupOld(exe) // Windows: removes nah.exe.old; elsewhere a no-op
	if _, err := os.Stat(exe + ".old"); err == nil {
		t.Fatal("the previous program must be cleaned up")
	}
	if _, err := os.Stat(exe); err != nil {
		t.Fatal("cleanup must never remove the program itself")
	}
}

func TestReplaceExecutableFailsCleanlyWhenTheFolderCannotBeWritten(t *testing.T) {
	if runtime.GOOS == "windows" || os.Getuid() == 0 {
		t.Skip("needs Unix permissions and a non-root user")
	}
	dir := t.TempDir()
	exe := filepath.Join(dir, "nah")
	os.WriteFile(exe, []byte("OLD"), 0o755)
	os.Chmod(dir, 0o500)
	defer os.Chmod(dir, 0o700)
	err := ReplaceExecutable(exe, []byte("NEW"))
	if err == nil || !strings.Contains(err.Error(), "cannot write in") {
		t.Fatalf("%v", err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "OLD" {
		t.Fatal("a failed update must leave the working program untouched")
	}
}

func TestReplaceExecutableOnAMissingFileIsAnError(t *testing.T) {
	if err := ReplaceExecutable(filepath.Join(t.TempDir(), "nope"), []byte("x")); err == nil {
		t.Fatal("nothing to replace")
	}
}

func TestTheTokenIsOnlySentToGitHubsAPI(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
		w.Write([]byte("[]"))
	}))
	defer srv.Close()
	if _, err := FetchWithToken(context.Background(), http.DefaultClient, srv.URL, "secret-token"); err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("a mirror or a test server must never receive the token, got %q", got)
	}
}
