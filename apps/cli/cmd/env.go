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
}

// DefaultEnv wires the real process environment.
func DefaultEnv(version, commit, date string) Env {
	stdinTTY := term.IsTerminal(int(os.Stdin.Fd()))
	return Env{
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
