// Package device identifies this computer without asking the user anything.
//
// The identifier is only ever used as a hash (and the gateway hashes it again with its own secret), so a
// machine id never leaves the machine in clear. It is a *friction* against mass account creation, not a
// proof: whoever controls the machine can forge it. That is the honest trade-off of having no e-mail.
package device

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unicode"
)

// Source is everything the fingerprint reads from the system; tests provide fakes for other OSes.
type Source struct {
	GOOS     string
	ReadFile func(string) ([]byte, error)
	Run      func(name string, args ...string) ([]byte, error)
	// MachineGUID reads Windows' HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid.
	MachineGUID func() (string, error)
	// Override replaces the machine identifier (from NAH_DEVICE_ID). It exists to simulate other computers while
	// testing on one machine; it grants nothing a person could not already do by editing their own machine id.
	Override string
	// DataDir is where a fallback install id is persisted.
	DataDir  string
	Hostname func() (string, error)
}

// System returns the real system source for dataDir.
func System(dataDir string) Source {
	return Source{
		GOOS:        runtime.GOOS,
		ReadFile:    os.ReadFile,
		Run:         run,
		MachineGUID: machineGUID,
		DataDir:     dataDir,
		Override:    os.Getenv("NAH_DEVICE_ID"),
		Hostname:    os.Hostname,
	}
}

// Result of a fingerprint.
type Result struct {
	// Hash is sha256 of a versioned, app-specific salt plus the raw id: what the gateway receives.
	Hash string
	// Method says where the id came from (for diagnostics; never the id itself).
	Method string
}

var hexID = regexp.MustCompile(`^[0-9a-fA-F-]{16,64}$`)

// bogus ids that many cloned images or broken installs share: useless as an identity.
var bogus = map[string]bool{
	"":                                     true,
	"00000000000000000000000000000000":     true,
	"00000000-0000-0000-0000-000000000000": true,
	"ffffffff-ffff-ffff-ffff-ffffffffffff": true,
	"uninitialized":                        true,
}

// Fingerprint returns this machine's hash, using the platform's own machine id and falling back to a random
// per-installation id (stored once) when the system offers none, as on containers and some BSDs.
func Fingerprint(s Source) (Result, error) {
	if strings.TrimSpace(s.Override) != "" {
		return Result{Hash: hash(s.Override), Method: "override"}, nil
	}
	if raw, method := s.rawID(); raw != "" {
		return Result{Hash: hash(raw), Method: method}, nil
	}
	raw, err := s.installID()
	if err != nil {
		return Result{}, fmt.Errorf("cannot identify this computer: %w", err)
	}
	return Result{Hash: hash(raw), Method: "install-id"}, nil
}

func hash(raw string) string {
	sum := sha256.Sum256([]byte("nah-device-v1:" + strings.ToLower(strings.TrimSpace(raw))))
	return hex.EncodeToString(sum[:])
}

func (s Source) rawID() (string, string) {
	valid := func(id string) string {
		id = strings.TrimSpace(id)
		if bogus[strings.ToLower(id)] || !hexID.MatchString(id) {
			return ""
		}
		return id
	}
	switch s.GOOS {
	case "linux":
		for _, p := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
			if b, err := s.ReadFile(p); err == nil {
				if id := valid(string(b)); id != "" {
					return id, "machine-id"
				}
			}
		}
	case "darwin":
		if out, err := s.Run("ioreg", "-rd1", "-c", "IOPlatformExpertDevice"); err == nil {
			if id := valid(parseIOPlatformUUID(string(out))); id != "" {
				return id, "ioreg"
			}
		}
		if out, err := s.Run("sysctl", "-n", "kern.uuid"); err == nil {
			if id := valid(string(out)); id != "" {
				return id, "sysctl"
			}
		}
	case "windows":
		if s.MachineGUID != nil {
			if g, err := s.MachineGUID(); err == nil {
				if id := valid(g); id != "" {
					return id, "registry"
				}
			}
		}
	}
	return "", ""
}

var ioregUUID = regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"`)

func parseIOPlatformUUID(out string) string {
	if m := ioregUUID.FindStringSubmatch(out); m != nil {
		return m[1]
	}
	return ""
}

// installID is a random id created on first use and kept in DataDir: one per installation.
func (s Source) installID() (string, error) {
	if s.DataDir == "" {
		return "", errors.New("no data directory")
	}
	path := filepath.Join(s.DataDir, "install-id")
	if b, err := s.ReadFile(path); err == nil {
		if id := strings.TrimSpace(string(b)); len(id) >= 32 {
			return id, nil
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := hex.EncodeToString(buf)
	if err := os.MkdirAll(s.DataDir, 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(id+"\n"), 0o600); err != nil {
		return "", err
	}
	return id, nil
}

// Name is a friendly label for this computer: "ada-laptop (linux)".
func (s Source) Name() string {
	host := "computer"
	if s.Hostname != nil {
		if h, err := s.Hostname(); err == nil && strings.TrimSpace(h) != "" {
			host = h
		}
	}
	host = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, host)
	if i := strings.IndexByte(host, '.'); i > 0 {
		host = host[:i] // "ada-laptop.local" -> "ada-laptop"
	}
	if r := []rune(host); len(r) > 40 {
		host = string(r[:40])
	}
	os := map[string]string{"darwin": "macos", "windows": "windows", "linux": "linux"}[s.GOOS]
	if os == "" {
		os = s.GOOS
	}
	return fmt.Sprintf("%s (%s)", host, os)
}
