package device

import "os/exec"

func run(name string, args ...string) ([]byte, error) { return exec.Command(name, args...).Output() }
