//go:build windows

package update

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// ReplaceExecutable puts data in place of the program at exe. Windows will not let a running program be overwritten or deleted,
// but it does let it be renamed: the old one is moved aside as nah.exe.old (removed on the next run) and the new one takes its name.
func ReplaceExecutable(exe string, data []byte) error {
	old, next := exe+".old", exe+".new"
	_ = os.Remove(old) // left by a previous update
	if err := os.WriteFile(next, data, 0o755); err != nil {
		return explainWrite(exe, err)
	}
	if err := os.Rename(exe, old); err != nil {
		os.Remove(next)
		return explainWrite(exe, err)
	}
	if err := os.Rename(next, exe); err != nil {
		_ = os.Rename(old, exe) // put the working program back
		os.Remove(next)
		return explainWrite(exe, err)
	}
	return nil
}

func explainWrite(exe string, err error) error {
	if errors.Is(err, os.ErrPermission) {
		return fmt.Errorf("cannot write in %s: %w. Run the update from a terminal with the right permissions, or reinstall with install.ps1 into a folder you own", filepath.Dir(exe), err)
	}
	return err
}

// CleanupOld removes the previous program left beside the new one by an earlier update. Best effort.
func CleanupOld(exe string) { _ = os.Remove(exe + ".old") }
