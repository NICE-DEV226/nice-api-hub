// Package update finds newer releases of nah on GitHub and replaces the running program with one, after checking it.
package update

import (
	"strconv"
	"strings"
)

// Version is a semantic version: 1.2.3 or 1.2.3-rc.1.
type Version struct {
	Major, Minor, Patch int
	Pre                 []string // pre-release identifiers, empty for a final release
}

// ParseVersion accepts "1.2.3", "v1.2.3" and "cli/v1.2.3-rc.1"; build metadata ("+abc") is ignored.
func ParseVersion(s string) (Version, bool) {
	s = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(s), "cli/"), "v")
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	var pre string
	if i := strings.IndexByte(s, '-'); i >= 0 {
		s, pre = s[:i], s[i+1:]
		if pre == "" {
			return Version{}, false
		}
	}
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return Version{}, false
	}
	var n [3]int
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 || (len(p) > 1 && p[0] == '0') {
			return Version{}, false
		}
		n[i] = v
	}
	v := Version{Major: n[0], Minor: n[1], Patch: n[2]}
	if pre != "" {
		v.Pre = strings.Split(pre, ".")
		for _, id := range v.Pre {
			if id == "" {
				return Version{}, false
			}
		}
	}
	return v, true
}

func (v Version) String() string {
	s := strconv.Itoa(v.Major) + "." + strconv.Itoa(v.Minor) + "." + strconv.Itoa(v.Patch)
	if len(v.Pre) > 0 {
		s += "-" + strings.Join(v.Pre, ".")
	}
	return s
}

// IsPrerelease reports whether v carries a pre-release suffix.
func (v Version) IsPrerelease() bool { return len(v.Pre) > 0 }

// Compare returns -1, 0 or 1 following semver precedence: 1.0.0-rc.1 < 1.0.0-rc.2 < 1.0.0.
func Compare(a, b Version) int {
	for _, p := range [][2]int{{a.Major, b.Major}, {a.Minor, b.Minor}, {a.Patch, b.Patch}} {
		if p[0] != p[1] {
			if p[0] < p[1] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(a.Pre) == 0 && len(b.Pre) == 0:
		return 0
	case len(a.Pre) == 0:
		return 1 // a final release outranks its own pre-releases
	case len(b.Pre) == 0:
		return -1
	}
	for i := 0; i < len(a.Pre) && i < len(b.Pre); i++ {
		if c := compareIdent(a.Pre[i], b.Pre[i]); c != 0 {
			return c
		}
	}
	switch {
	case len(a.Pre) < len(b.Pre):
		return -1
	case len(a.Pre) > len(b.Pre):
		return 1
	}
	return 0
}

func compareIdent(a, b string) int {
	an, aerr := strconv.Atoi(a)
	bn, berr := strconv.Atoi(b)
	switch {
	case aerr == nil && berr == nil:
		if an < bn {
			return -1
		} else if an > bn {
			return 1
		}
		return 0
	case aerr == nil:
		return -1 // numeric identifiers rank below alphanumeric ones
	case berr == nil:
		return 1
	}
	return strings.Compare(a, b)
}
