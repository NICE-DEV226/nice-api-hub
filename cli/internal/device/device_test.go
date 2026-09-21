package device

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func files(m map[string]string) func(string) ([]byte, error) {
	return func(p string) ([]byte, error) {
		if v, ok := m[p]; ok {
			return []byte(v), nil
		}
		return nil, os.ErrNotExist
	}
}

func none(string, ...string) ([]byte, error) { return nil, errors.New("not found") }

const linuxID = "3f9c1d2e8b7a4c6d9e0f1a2b3c4d5e6f"

func TestLinuxUsesMachineIDAndFallsBackToDbus(t *testing.T) {
	r, err := Fingerprint(Source{GOOS: "linux", ReadFile: files(map[string]string{"/etc/machine-id": linuxID + "\n"}), Run: none})
	if err != nil || r.Method != "machine-id" || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(r.Hash) {
		t.Fatalf("%+v %v", r, err)
	}
	r2, _ := Fingerprint(Source{GOOS: "linux", ReadFile: files(map[string]string{"/var/lib/dbus/machine-id": linuxID}), Run: none})
	if r2.Hash != r.Hash {
		t.Fatal("both locations describe the same machine")
	}
}

func TestMacOSParsesIOPlatformUUIDFromRealIoregOutput(t *testing.T) {
	ioreg := `+-o Root  <class IORegistryEntry, id 0x100000100, retain 25>
  +-o MacBookPro18,3  <class IOPlatformExpertDevice, id 0x10000020f, registered, matched, active, busy 0 (68 ms), retain 39>
    {
      "IOPolledInterface" = "AppleARMWatchdogTimerHibernateHandler is not serializable"
      "manufacturer" = <"Apple Inc.">
      "IOPlatformUUID" = "4C4C4544-0035-5A10-8034-B7C04F4B4E32"
      "serial-number" = <"C02XXXXXXXXX">
    }`
	s := Source{GOOS: "darwin", ReadFile: files(nil), Run: func(name string, args ...string) ([]byte, error) {
		if name == "ioreg" {
			return []byte(ioreg), nil
		}
		return nil, errors.New("unexpected")
	}}
	r, err := Fingerprint(s)
	if err != nil || r.Method != "ioreg" {
		t.Fatalf("%+v %v", r, err)
	}
	// falls back to sysctl when ioreg is unavailable
	s.Run = func(name string, args ...string) ([]byte, error) {
		if name == "sysctl" {
			return []byte("4C4C4544-0035-5A10-8034-B7C04F4B4E32\n"), nil
		}
		return nil, errors.New("no ioreg")
	}
	r2, _ := Fingerprint(s)
	if r2.Method != "sysctl" || r2.Hash != r.Hash {
		t.Fatalf("sysctl must describe the same machine: %+v vs %+v", r2, r)
	}
}

func TestWindowsUsesMachineGuid(t *testing.T) {
	r, err := Fingerprint(Source{GOOS: "windows", ReadFile: files(nil), Run: none, MachineGUID: func() (string, error) { return "0f1e2d3c-4b5a-6978-8899-aabbccddeeff", nil }})
	if err != nil || r.Method != "registry" {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestBogusOrMissingIDsFallBackToAStableInstallID(t *testing.T) {
	dir := t.TempDir()
	cases := []Source{
		{GOOS: "linux", ReadFile: files(map[string]string{"/etc/machine-id": "uninitialized\n"}), Run: none},
		{GOOS: "linux", ReadFile: files(map[string]string{"/etc/machine-id": strings.Repeat("0", 32)}), Run: none},
		{GOOS: "windows", ReadFile: files(nil), Run: none, MachineGUID: func() (string, error) { return "", errors.New("access denied") }},
		{GOOS: "freebsd", ReadFile: files(nil), Run: none},
	}
	var first string
	for i, c := range cases {
		c.DataDir = dir
		fake := c.ReadFile
		c.ReadFile = func(p string) ([]byte, error) { // fakes for system files, the real FS only for our own install id
			if strings.HasPrefix(p, dir) {
				return os.ReadFile(p)
			}
			return fake(p)
		}
		r, err := Fingerprint(c)
		if err != nil || r.Method != "install-id" {
			t.Fatalf("case %d: %+v %v", i, r, err)
		}
		if first == "" {
			first = r.Hash
		} else if r.Hash != first {
			t.Fatalf("case %d: the install id must be stable across runs", i)
		}
	}
	if st, err := os.Stat(filepath.Join(dir, "install-id")); err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("install id file: %v %v", st, err)
	}
}

func TestFingerprintNeverLeaksTheRawID(t *testing.T) {
	r, _ := Fingerprint(Source{GOOS: "linux", ReadFile: files(map[string]string{"/etc/machine-id": linuxID}), Run: none})
	if strings.Contains(r.Hash, linuxID) {
		t.Fatal("the raw id must not appear")
	}
	other, _ := Fingerprint(Source{GOOS: "linux", ReadFile: files(map[string]string{"/etc/machine-id": strings.Repeat("a", 32)}), Run: none})
	if other.Hash == r.Hash {
		t.Fatal("different machines must differ")
	}
}

func TestNoDataDirAndNoIDIsAClearError(t *testing.T) {
	if _, err := Fingerprint(Source{GOOS: "freebsd", ReadFile: files(nil), Run: none}); err == nil {
		t.Fatal("must fail loudly, not invent an identity")
	}
}

func TestNameIsFriendlyAndSafe(t *testing.T) {
	cases := []struct {
		host, goos, want string
	}{
		{"ada-laptop.local", "darwin", "ada-laptop (macos)"},
		{"DESKTOP-7QK2", "windows", "DESKTOP-7QK2 (windows)"},
		{"box", "linux", "box (linux)"},
		{"we\x00ird\nname", "linux", "weirdname (linux)"},
		{strings.Repeat("x", 90), "linux", strings.Repeat("x", 40) + " (linux)"},
		{"", "linux", "computer (linux)"},
	}
	for _, c := range cases {
		s := Source{GOOS: c.goos, Hostname: func() (string, error) { return c.host, nil }}
		if got := s.Name(); got != c.want {
			t.Errorf("%q -> %q want %q", c.host, got, c.want)
		}
	}
	if got := (Source{GOOS: "linux", Hostname: func() (string, error) { return "", errors.New("x") }}).Name(); got != "computer (linux)" {
		t.Error(got)
	}
}
