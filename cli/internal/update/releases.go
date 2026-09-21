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
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strings"
)

// DefaultAPI lists the releases of the repository. Releases of the app are the ones whose tag starts with TagPrefix; the
// API's own releases (if any) live in the same list.
const (
	DefaultAPI = "https://api.github.com/repos/NICE-DEV226/nice-api-hub/releases?per_page=100"
	TagPrefix  = "cli/v"
)

// Asset is one downloadable file of a release.
type Asset struct {
	Name string
	URL  string
	Size int64
}

// Release is a published version of nah.
type Release struct {
	Version    Version
	Tag        string
	Prerelease bool
	Page       string // where a person reads about it
	Assets     []Asset
}

// Asset finds a file of the release by name.
func (r Release) Asset(name string) (Asset, bool) {
	for _, a := range r.Assets {
		if a.Name == name {
			return a, true
		}
	}
	return Asset{}, false
}

// ArchiveName is the name of the archive published for a system: nah_1.2.3_linux_amd64.tar.gz, nah_1.2.3_windows_arm64.zip.
func ArchiveName(version, goos, goarch string) string {
	ext := ".tar.gz"
	if goos == "windows" {
		ext = ".zip"
	}
	return "nah_" + version + "_" + goos + "_" + goarch + ext
}

type apiRelease struct {
	TagName    string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	HTMLURL    string `json:"html_url"`
	Assets     []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
		Size int64  `json:"size"`
	} `json:"assets"`
}

// Fetch reads the list of releases from api and returns those of the app, newest version first. Drafts and tags that are not
// versions are ignored.
func Fetch(ctx context.Context, hc *http.Client, api string) ([]Release, error) {
	return FetchWithToken(ctx, hc, api, "")
}

// FetchWithToken is Fetch with a GitHub token, which lifts the low limit on anonymous requests. The token is only ever sent to
// api.github.com, never to a mirror or a redirect target.
func FetchWithToken(ctx context.Context, hc *http.Client, api, token string) ([]Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "nah-update")
	if token != "" && req.URL.Scheme == "https" && req.URL.Host == "api.github.com" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cannot reach %s: %w", req.URL.Host, err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
		return nil, errors.New("GitHub is rate-limiting this address; try again in a few minutes, or set GITHUB_TOKEN to raise the limit")
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the release list answered HTTP %d", res.StatusCode)
	}
	var raw []apiRelease
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("unexpected answer from the release list: %w", err)
	}
	var out []Release
	for _, r := range raw {
		if r.Draft || !strings.HasPrefix(r.TagName, TagPrefix) {
			continue
		}
		v, ok := ParseVersion(r.TagName)
		if !ok {
			continue
		}
		rel := Release{Version: v, Tag: r.TagName, Prerelease: r.Prerelease || v.IsPrerelease(), Page: r.HTMLURL}
		for _, a := range r.Assets {
			rel.Assets = append(rel.Assets, Asset{Name: a.Name, URL: a.URL, Size: a.Size})
		}
		out = append(out, rel)
	}
	sort.SliceStable(out, func(i, j int) bool { return Compare(out[i].Version, out[j].Version) > 0 })
	return out, nil
}

// Latest is the newest release; pre-releases only count when includePre is set.
func Latest(rs []Release, includePre bool) (Release, bool) {
	for _, r := range rs { // already newest first
		if includePre || !r.Prerelease {
			return r, true
		}
	}
	return Release{}, false
}

// Find returns the release of an exact version.
func Find(rs []Release, version string) (Release, bool) {
	want, ok := ParseVersion(version)
	if !ok {
		return Release{}, false
	}
	for _, r := range rs {
		if Compare(r.Version, want) == 0 {
			return r, true
		}
	}
	return Release{}, false
}

// Download fetches url into memory, refusing anything larger than limit bytes.
func Download(ctx context.Context, hc *http.Client, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "nah-update")
	res, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d for %s", res.StatusCode, path.Base(url))
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s is larger than the %d MB limit", path.Base(url), limit>>20)
	}
	return data, nil
}

// ChecksumFor finds the SHA-256 of a file in a SHA256SUMS document ("<hex>  <name>" per line).
func ChecksumFor(sums []byte, file string) (string, bool) {
	for _, line := range strings.Split(string(sums), "\n") {
		f := strings.Fields(line)
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == file && len(f[0]) == 64 {
			return strings.ToLower(f[0]), true
		}
	}
	return "", false
}

// VerifySHA256 checks data against a hex digest.
func VerifySHA256(data []byte, want string) error {
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != strings.ToLower(want) {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", want, got)
	}
	return nil
}

const maxBinary = 200 << 20

// ExtractBinary returns the program (nah or nah.exe) from a release archive. Only that one member is read, by its base name,
// so a crafted archive cannot write anywhere or expand without bound.
func ExtractBinary(archive []byte, archiveName string) ([]byte, error) {
	if strings.HasSuffix(archiveName, ".zip") {
		zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
		if err != nil {
			return nil, err
		}
		for _, f := range zr.File {
			if f.FileInfo().IsDir() || path.Base(f.Name) != "nah.exe" {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return readCapped(rc)
		}
		return nil, errors.New("the archive does not contain nah.exe")
	}
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil, errors.New("the archive does not contain nah")
		}
		if err != nil {
			return nil, err
		}
		if h.Typeflag == tar.TypeReg && path.Base(h.Name) == "nah" {
			return readCapped(tr)
		}
	}
}

func readCapped(r io.Reader) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, maxBinary+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxBinary {
		return nil, errors.New("the program in the archive is unreasonably large")
	}
	if len(b) == 0 {
		return nil, errors.New("the program in the archive is empty")
	}
	return b, nil
}
