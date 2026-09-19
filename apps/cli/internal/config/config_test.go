package config

import (
	"os"
	"path/filepath"
	"runtime"
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
