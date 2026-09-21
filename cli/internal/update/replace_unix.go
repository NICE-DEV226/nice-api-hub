//go:build !windows

package update

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// ReplaceExecutable puts data in place of the program at exe. The new file is written next to it and renamed over it, which is
// atomic and allowed while the old one is running.
func ReplaceExecutable(exe string, data []byte) error {
	st, err := os.Stat(exe)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(exe), ".nah-update-*")
	if err != nil {
		return explainWrite(exe, err)
	}
	name := tmp.Name()
	fail := func(err error) error { tmp.Close(); os.Remove(name); return err }
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	if err := tmp.Chmod(st.Mode().Perm() | 0o111); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, exe); err != nil {
		os.Remove(name)
		return explainWrite(exe, err)
	}
	return nil
}

func explainWrite(exe string, err error) error {
	if errors.Is(err, os.ErrPermission) {
		return fmt.Errorf("cannot write in %s: %w. Run the update with the right permissions (sudo), or reinstall with install.sh into a folder you own", filepath.Dir(exe), err)
	}
	return err
}

// CleanupOld does nothing here: only Windows leaves a previous program behind.
func CleanupOld(string) {}
