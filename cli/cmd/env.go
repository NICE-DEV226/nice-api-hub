// Package cmd defines the `nah` command line.
package cmd

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/term"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/clip"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/device"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/onboard"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/paths"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/vault"
)

// Prompter abstracts interactive input so commands are testable.
type Prompter interface {
	ReadLine(prompt string) (string, error)
	ReadSecret(prompt string) (string, error)
	Confirm(prompt string) (bool, error)
}

// Env carries everything a command needs from the outside world.
type Env struct {
	Out, Err io.Writer
	In       io.Reader
	Getenv   func(string) string
	// ConfigPath overrides the config file location (tests).
	ConfigPath string
	// Interactive: stdout is a terminal, so styled tables and the full-screen UI make sense.
	Interactive bool
	// StderrTTY: stderr is a terminal, so spinners and progress bars can be drawn there.
	StderrTTY  bool
	Prompt     Prompter
	Now        func() time.Time
	HTTPClient *http.Client
	Version    string
	Commit     string
	Date       string

	// Secrets is the OS credential store; nil keeps secrets in the private config file only.
	Secrets config.SecretStore
	// Device identifies this computer (fingerprint, friendly name).
	Device device.Source
	// Clipboard copies text for the user.
	Clipboard clip.Copier
	// Paths says where per-OS things live.
	Paths paths.Env
	// HistoryPath overrides where the download history lives (tests); empty means the per-OS data directory.
	HistoryPath string
	// Solve overrides the proof-of-work solver (tests).
	Solve onboard.Solver
}

// DefaultEnv wires the real process environment.
func DefaultEnv(version, commit, date string) Env {
	stdinTTY := term.IsTerminal(int(os.Stdin.Fd()))
	ps := paths.System()
	dataDir, _ := ps.DataDir()
	var secrets config.SecretStore
	if os.Getenv("NAH_NO_KEYRING") == "" {
		secrets = vault.Keyring{}
	}
	return Env{
		Secrets:     secrets,
		Device:      device.System(dataDir),
		Paths:       ps,
		Out:         os.Stdout,
		Err:         os.Stderr,
		In:          os.Stdin,
		Getenv:      os.Getenv,
		Interactive: term.IsTerminal(int(os.Stdout.Fd())),
		StderrTTY:   term.IsTerminal(int(os.Stderr.Fd())),
		Prompt:      &terminalPrompter{in: bufio.NewReader(os.Stdin), out: os.Stderr, tty: stdinTTY, fd: int(os.Stdin.Fd())},
		Now:         time.Now,
		Version:     version,
		Commit:      commit,
		Date:        date,
	}
}

type terminalPrompter struct {
	in  *bufio.Reader
	out io.Writer
	tty bool
	fd  int
}

func (p *terminalPrompter) ReadLine(prompt string) (string, error) {
	fmt.Fprint(p.out, prompt)
	s, err := p.in.ReadString('\n')
	if err != nil && (err != io.EOF || s == "") {
		return "", err
	}
	return strings.TrimSpace(s), nil
}

func (p *terminalPrompter) ReadSecret(prompt string) (string, error) {
	if !p.tty {
		return p.ReadLine(prompt)
	}
	fmt.Fprint(p.out, prompt)
	b, err := term.ReadPassword(p.fd)
	fmt.Fprintln(p.out)
	return strings.TrimSpace(string(b)), err
}

func (p *terminalPrompter) Confirm(prompt string) (bool, error) {
	s, err := p.ReadLine(prompt + " [y/N] ")
	if err != nil {
		return false, err
	}
	s = strings.ToLower(s)
	return s == "y" || s == "yes", nil
}
