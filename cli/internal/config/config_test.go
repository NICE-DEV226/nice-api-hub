package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadMissingFileIsEmpty(t *testing.T) {
	f, err := Load(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil || len(f.Profiles) != 0 {
		t.Fatalf("%+v %v", f, err)
	}
}

func TestSaveIsPrivateAndRoundTrips(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "nah", "config.json")
	f := &File{Current: "prod", Profiles: map[string]Profile{"prod": {URL: "https://api.x", APIKey: "nah_live_k", AdminToken: "tok"}}}
	if err := f.Save(path); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		st, _ := os.Stat(path)
		if st.Mode().Perm() != 0o600 {
			t.Errorf("config holds secrets, mode must be 0600, got %v", st.Mode().Perm())
		}
		dst, _ := os.Stat(filepath.Dir(path))
		if dst.Mode().Perm() != 0o700 {
			t.Errorf("config dir must be 0700, got %v", dst.Mode().Perm())
		}
	}
	back, err := Load(path)
	if err != nil || back.Profiles["prod"].APIKey != "nah_live_k" || back.Current != "prod" {
		t.Fatalf("%+v %v", back, err)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Errorf("temp files must not be left behind: %v", entries)
	}
}

func TestLoadRejectsCorruptFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "c.json")
	os.WriteFile(p, []byte("{nope"), 0o600)
	if _, err := Load(p); err == nil {
		t.Fatal("corrupt JSON must be reported, not silently ignored")
	}
}

func TestResolvePrecedence(t *testing.T) {
	f := &File{Current: "work", Profiles: map[string]Profile{
		"work":  {URL: "https://work.example/", APIKey: "file-key", AdminToken: "file-admin"},
		"other": {URL: "https://other.example"},
	}}
	// file only
	r := Resolve(f, "", "", env(nil))
	if r.Profile != "work" || r.URL != "https://work.example" || r.APIKey != "file-key" {
		t.Fatalf("%+v", r)
	}
	// env beats file
	r = Resolve(f, "", "", env(map[string]string{"NAH_URL": "http://env:1", "NAH_API_KEY": "env-key"}))
	if r.URL != "http://env:1" || r.APIKey != "env-key" || r.AdminToken != "file-admin" {
		t.Fatalf("%+v", r)
	}
	// flag beats env; profile flag beats env profile
	r = Resolve(f, "other", "http://flag:2/", env(map[string]string{"NAH_URL": "http://env:1", "NAH_PROFILE": "work"}))
	if r.Profile != "other" || r.URL != "http://flag:2" {
		t.Fatalf("%+v", r)
	}
	// nothing at all -> local default
	r = Resolve(&File{}, "", "", env(nil))
	if r.URL != DefaultURL || r.Profile != "default" || r.APIKey != "" {
		t.Fatalf("%+v", r)
	}
}

func TestMask(t *testing.T) {
	if Mask("") != "(not set)" || Mask("short") != "•••••" {
		t.Fatal("short/empty masks")
	}
	m := Mask("nah_live_Leh5DCznLgBi5PHcfWI_AZ3SACfYmgV8")
	if m != "nah_live_••••••••V8" {
		t.Fatalf("got %q", m)
	}
}

type memStore struct {
	m       map[string]string
	failSet bool
	failGet bool
}

func (s *memStore) Get(p, k string) (string, error) {
	if s.failGet {
		return "", os.ErrPermission
	}
	v, ok := s.m[p+"/"+k]
	if !ok {
		return "", os.ErrNotExist
	}
	return v, nil
}
func (s *memStore) Set(p, k, v string) error {
	if s.failSet {
		return os.ErrPermission
	}
	s.m[p+"/"+k] = v
	return nil
}
func (s *memStore) Delete(p, k string) error { delete(s.m, p+"/"+k); return nil }

func TestSecretsGoToTheKeychainAndNeverTouchTheFile(t *testing.T) {
	st := &memStore{m: map[string]string{}}
	f := &File{Profiles: map[string]Profile{"default": {URL: "https://x"}}}
	inStore, err := f.StoreSecret(st, "default", KindAPIKey, "nah_live_secret")
	if err != nil || !inStore {
		t.Fatalf("%v %v", inStore, err)
	}
	path := filepath.Join(t.TempDir(), "c.json")
	if err := f.Save(path); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), "nah_live_secret") {
		t.Fatalf("the secret leaked into the file:\n%s", raw)
	}
	back, _ := Load(path)
	r := Resolve(back, "", "", env(nil))
	if r.APIKey != "" {
		t.Fatal("not hydrated yet")
	}
	if err := r.Hydrate(back, st); err != nil || r.APIKey != "nah_live_secret" {
		t.Fatalf("%q %v", r.APIKey, err)
	}
}

func TestSecretsFallBackToThePrivateFileWithoutAKeychain(t *testing.T) {
	st := &memStore{m: map[string]string{}, failSet: true}
	f := &File{Profiles: map[string]Profile{"default": {}}}
	inStore, err := f.StoreSecret(st, "default", KindAdmin, "tok")
	if err != nil || inStore || f.Profiles["default"].AdminToken != "tok" || len(f.Profiles["default"].Vaulted) != 0 {
		t.Fatalf("%v %v %+v", inStore, err, f.Profiles["default"])
	}
	// nil store behaves the same
	g := &File{Profiles: map[string]Profile{"default": {}}}
	if in, _ := g.StoreSecret(nil, "default", KindAPIKey, "k"); in || g.Profiles["default"].APIKey != "k" {
		t.Fatal("nil store means file")
	}
}

func TestMovingASecretBetweenStoresLeavesNoCopy(t *testing.T) {
	st := &memStore{m: map[string]string{}}
	f := &File{Profiles: map[string]Profile{"default": {APIKey: "old-in-file"}}}
	f.StoreSecret(st, "default", KindAPIKey, "new")
	if f.Profiles["default"].APIKey != "" {
		t.Fatal("the plaintext copy must be wiped once the secret is in the keychain")
	}
	f.StoreSecret(st, "default", KindAPIKey, "")
	if _, ok := st.m["default/api-key"]; ok || f.Profiles["default"].isVaulted(KindAPIKey) {
		t.Fatal("removal must clear the keychain and the marker")
	}
}

func TestEnvironmentBeatsTheKeychainAndAnUnreadableKeychainIsReported(t *testing.T) {
	st := &memStore{m: map[string]string{"default/api-key": "from-keychain"}}
	f := &File{Profiles: map[string]Profile{"default": {Vaulted: []string{KindAPIKey}}}}
	r := Resolve(f, "", "", env(map[string]string{"NAH_API_KEY": "from-env"}))
	if err := r.Hydrate(f, st); err != nil || r.APIKey != "from-env" {
		t.Fatalf("%q %v", r.APIKey, err)
	}
	r = Resolve(f, "", "", env(nil))
	st.failGet = true
	if err := r.Hydrate(f, st); err == nil || r.APIKey != "" {
		t.Fatalf("a broken keychain must surface as a warning: %v", err)
	}
	r = Resolve(f, "", "", env(nil))
	if err := r.Hydrate(f, nil); err == nil {
		t.Fatal("a profile whose secret is in a keychain we cannot reach must say so")
	}
}
