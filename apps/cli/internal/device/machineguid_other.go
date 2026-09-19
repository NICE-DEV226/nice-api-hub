//go:build !windows

package device

import "errors"

func machineGUID() (string, error) { return "", errors.New("not windows") }
