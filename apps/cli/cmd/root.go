package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/config"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

// Exit codes.
const (
	ExitOK       = 0
	ExitFailure  = 1
	ExitUsage    = 2
	ExitAuth     = 3
	ExitCanceled = 130
)

type usageError struct{ error }

func usageErr(err error) error { return usageError{err} }

// statusError makes a command fail with a specific exit code without printing a message
// (the command already explained itself), e.g. `nah status` when something is down.
type statusError struct{ code int }

func (e statusError) Error() string { return fmt.Sprintf("exit status %d", e.code) }

type app struct {
	env     Env
	jsonOut bool
	profile string
	urlFlag string
	timeout time.Duration
	cfgPath string
	file    *config.File
	res     config.Resolved
}

// NewRoot builds the command tree.
func NewRoot(env Env) *cobra.Command {
	a := &app{env: env}
	root := &cobra.Command{
		Use:   "nah",
		Short: "Command line and terminal UI for NICE-API'HUB",
		Long: ui.Title.Render("nah") + " — operate and use a NICE-API'HUB gateway.\n\n" +
			"Customers resolve and download media; operators manage accounts and keys.\n" +
			"Just run " + ui.Code.Render("nah") + ": it opens the interface and sets your account up the first time.",
		SilenceUsage:      true,
		SilenceErrors:     true,
		DisableAutoGenTag: true,
		PersistentPreRunE: a.init,
		// Plain `nah` on a terminal opens the interface; anywhere else it shows the help.
		RunE: func(cmd *cobra.Command, args []string) error {
			if a.env.Interactive {
				return a.runTUI(cmd, "")
			}
			return cmd.Help()
		},
	}
	root.SetOut(env.Out)
	root.SetErr(env.Err)
	root.SetIn(env.In)
	root.SetFlagErrorFunc(func(_ *cobra.Command, err error) error { return usageErr(err) })
	root.CompletionOptions.HiddenDefaultCmd = true

	pf := root.PersistentFlags()
	pf.StringVar(&a.urlFlag, "url", "", "gateway URL (default: profile, $NAH_URL, or "+config.DefaultURL+")")
	pf.StringVar(&a.profile, "profile", "", "configuration profile to use ($NAH_PROFILE)")
	pf.BoolVar(&a.jsonOut, "json", false, "machine-readable JSON output")
	pf.DurationVar(&a.timeout, "timeout", 90*time.Second, "timeout for non-streaming requests")

	root.AddCommand(
		a.loginCmd(), a.configCmd(), a.statusCmd(), a.mediaCmd(), a.downloadCmd(),
		a.jobsCmd(), a.accountCmd(), a.usageCmd(), a.adminCmd(), a.tuiCmd(), a.versionCmd(),
		a.initCmd(), a.registerCmd(), a.linkCmd(), a.recoverCmd(), a.keysCmd(), a.historyCmd(), a.againCmd(),
	)
	return root
}

func (a *app) init(cmd *cobra.Command, _ []string) error {
	path := a.env.ConfigPath
	if path == "" {
		p, err := config.Path()
		if err != nil {
			return err
		}
		path = p
	}
	f, err := config.Load(path)
	if err != nil {
		return err
	}
	a.cfgPath, a.file = path, f
	a.res = config.Resolve(f, a.profile, a.urlFlag, a.env.Getenv)
	if err := a.res.Hydrate(f, a.env.Secrets); err != nil {
		fmt.Fprintln(a.env.Err, ui.Warning.Render("! ")+err.Error())
	}
	return nil
}

func (a *app) client() (*api.Client, error) {
	c, err := api.New(a.res.URL, a.res.APIKey, a.res.AdminToken)
	if err != nil {
		return nil, err
	}
	c.UserAgent = "nah-cli/" + a.env.Version
	if a.env.HTTPClient != nil {
		c.HTTP = a.env.HTTPClient
	}
	return c, nil
}

// ctx returns a context bounded by --timeout.
func (a *app) ctx(cmd *cobra.Command) (context.Context, context.CancelFunc) {
	base := cmd.Context()
	if base == nil {
		base = context.Background()
	}
	return context.WithTimeout(base, a.timeout)
}

func (a *app) printJSON(v any) error {
	enc := json.NewEncoder(a.env.Out)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func (a *app) println(s string) { fmt.Fprintln(a.env.Out, s) }

func (a *app) printf(format string, args ...any) { fmt.Fprintf(a.env.Out, format, args...) }

// requireYes asks for confirmation on destructive actions, or insists on --yes when not interactive.
func (a *app) requireYes(yes bool, question string) error {
	if yes {
		return nil
	}
	if !a.env.Interactive {
		return usageErr(errors.New("this action needs confirmation: re-run with --yes"))
	}
	ok, err := a.env.Prompt.Confirm(question)
	if err != nil {
		return err
	}
	if !ok {
		return statusError{code: ExitFailure}
	}
	return nil
}

// Execute runs the CLI and returns the process exit code.
func Execute(env Env) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	root := NewRoot(env)
	jsonMode := false
	for _, a := range os.Args[1:] {
		if a == "--json" || a == "--json=true" {
			jsonMode = true
		}
	}
	err := root.ExecuteContext(ctx)
	return RenderError(env, err, jsonMode)
}

// RenderError prints a helpful message for err and returns the matching exit code.
func RenderError(env Env, err error, jsonMode bool) int {
	if err == nil {
		return ExitOK
	}
	var se statusError
	if errors.As(err, &se) {
		return se.code
	}
	code := ExitFailure
	msg, hint, reqID := err.Error(), "", ""
	var extra map[string]any
	var pr *api.Problem
	var nc *api.ErrNotConfigured
	var ue usageError
	switch {
	case errors.As(err, &pr):
		msg, hint, reqID, extra = err.Error(), pr.Hint(), pr.RequestID, pr.Extra // keep any context added by callers
		if pr.Status == 401 || pr.Status == 403 {
			code = ExitAuth
		}
	case errors.As(err, &nc):
		code = ExitAuth
	case errors.As(err, &ue):
		code = ExitUsage
		hint = "Run with --help for usage."
	case errors.Is(err, context.Canceled):
		msg, code = "cancelled", ExitCanceled
	case errors.Is(err, context.DeadlineExceeded):
		msg, hint = "timed out", "Raise it with --timeout (extraction can take 15 s or more)."
	}

	if jsonMode {
		body := map[string]any{"message": msg}
		if pr != nil {
			body = map[string]any{"code": pr.Code, "status": pr.Status, "detail": pr.Detail, "requestId": pr.RequestID}
			for k, v := range pr.Extra {
				body[k] = v
			}
		}
		b, _ := json.Marshal(map[string]any{"error": body})
		fmt.Fprintln(env.Err, string(b))
		return code
	}

	fmt.Fprintln(env.Err, ui.Danger.Render("✗ ")+msg)
	if attempts, ok := extra["attempts"].([]any); ok {
		for _, at := range attempts {
			if m, ok := at.(map[string]any); ok {
				fmt.Fprintf(env.Err, "  %s %v: %v\n", ui.MutedText.Render("·"), m["provider"], m["outcome"])
			}
		}
	}
	if hint != "" {
		fmt.Fprintln(env.Err, ui.MutedText.Render("  "+hint))
	}
	if reqID != "" {
		fmt.Fprintln(env.Err, ui.MutedText.Render("  request id: "+reqID))
	}
	return code
}

func (a *app) versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version",
		Args:  exactArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			if a.jsonOut {
				return a.printJSON(map[string]string{"version": a.env.Version, "commit": a.env.Commit, "date": a.env.Date})
			}
			a.printf("nah %s (%s, %s)\n", a.env.Version, a.env.Commit, a.env.Date)
			return nil
		},
	}
}

func exactArgs(n int) cobra.PositionalArgs {
	return func(c *cobra.Command, args []string) error {
		if err := cobra.ExactArgs(n)(c, args); err != nil {
			return usageErr(err)
		}
		return nil
	}
}

func rangeArgs(min, max int) cobra.PositionalArgs {
	return func(c *cobra.Command, args []string) error {
		if err := cobra.RangeArgs(min, max)(c, args); err != nil {
			return usageErr(err)
		}
		return nil
	}
}

func joinNonEmpty(sep string, parts ...string) string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, sep)
}
