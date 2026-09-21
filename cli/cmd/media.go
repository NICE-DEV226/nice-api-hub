package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/tui"
	"github.com/NICE-DEV226/nice-api-hub/cli/internal/ui"
)

func (a *app) mediaCmd() *cobra.Command {
	var urlOnly bool
	var kind string
	cmd := &cobra.Command{
		Use:   "media <url>",
		Short: "Resolve a media URL into downloadable variants",
		Example: "  nah media https://www.youtube.com/watch?v=aqz-KE-bpKQ\n" +
			"  nah media --url-only --kind audio <url>     # just the best audio link, for scripts",
		Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := a.client()
			if err != nil {
				return usageErr(err)
			}
			ctx, cancel := a.ctx(cmd)
			defer cancel()
			res, err := a.withSpinner(ctx, "Resolving media", func(ctx context.Context) (*api.MediaResult, error) {
				return c.Media(ctx, args[0])
			})
			if err != nil {
				return err
			}
			switch {
			case a.jsonOut:
				return a.printJSON(res)
			case urlOnly:
				for _, v := range res.Data.Variants {
					if kind == "" || v.Kind == kind {
						a.println(v.URL)
						return nil
					}
				}
				return fmt.Errorf("no %s variant available", kind)
			}
			a.renderMedia(res.Data, &res.Meta)
			return nil
		},
	}
	cmd.Flags().BoolVar(&urlOnly, "url-only", false, "print only the URL of the best variant")
	cmd.Flags().StringVar(&kind, "kind", "", "with --url-only: video, audio or image")
	return cmd
}

// withSpinner shows a spinner on stderr while fn runs, when a terminal is attached.
func (a *app) withSpinner(ctx context.Context, label string, fn func(context.Context) (*api.MediaResult, error)) (*api.MediaResult, error) {
	if a.env.StderrTTY && !a.jsonOut {
		return tui.SpinResult(ctx, a.env.Err, label, fn)
	}
	return fn(ctx)
}

func (a *app) renderMedia(m api.Media, meta *api.MediaMeta) {
	a.println(ui.Bold.Render(ui.OneLine(ui.Deref(m.Title, "(untitled)"), 110)))
	dur := ""
	if m.DurationSeconds != nil {
		dur = ui.Duration(*m.DurationSeconds)
	}
	sub := joinNonEmpty(" · ", ui.Deref(m.Author, ""), dur, m.Platform, "via "+m.Provider)
	if meta != nil {
		sub += fmt.Sprintf(" · %d ms", meta.TookMs)
	}
	line := ui.MutedText.Render(sub)
	if meta != nil && meta.Cached {
		line += " " + ui.Badge.Render("cached")
	}
	a.println(line)
	a.println("")
	a.println(variantsTable(m.Variants))
	a.println(ui.MutedText.Render(ui.Plural(len(m.Variants), "variant", "variants") + ". Use `nah download <url>` to get one merged file."))
}

func variantsTable(vs []api.Variant) string {
	rows := make([][]string, 0, len(vs))
	for i, v := range vs {
		audio := "—"
		if v.Kind == "video" {
			switch {
			case v.HasAudio == nil:
				audio = "?"
			case *v.HasAudio:
				audio = "yes"
			default:
				audio = "no"
			}
		}
		size := "—"
		if v.SizeBytes > 0 {
			size = ui.Bytes(v.SizeBytes)
		}
		proto := v.Protocol
		if proto == "" {
			proto = "direct"
		}
		rows = append(rows, []string{
			fmt.Sprint(i + 1), v.Kind, dash(firstOf(v.Quality, v.Label)), dash(v.Codec), size, audio, proto, dash(strings.TrimPrefix(v.Ext, ".")),
		})
	}
	return ui.Table([]string{"#", "KIND", "QUALITY", "CODEC", "SIZE", "AUDIO", "PROTO", "EXT"}, rows)
}

func firstOf(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func dash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}
