package cmd

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/history"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/tui"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

func (a *app) downloadCmd() *cobra.Command {
	var out string
	var audio, mp3, force, quiet bool
	var maxHeight int
	cmd := &cobra.Command{
		Use:   "download <url>",
		Short: "Download the media as one playable file",
		Long: "The gateway fetches the media, merges separate video and audio tracks when needed (YouTube),\n" +
			"and streams a single file. Nothing is left behind if the transfer fails or is cancelled.",
		Example: "  nah download https://www.youtube.com/watch?v=aqz-KE-bpKQ --max-height 720\n" +
			"  nah download <url> --mp3 -o ~/Music/\n" +
			"  nah download <url> -o clip.mp4 --force",
		Args: exactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if mp3 {
				audio = true
			}
			if audio && maxHeight > 0 {
				return usageErr(errors.New("--max-height applies to video, not to --audio/--mp3"))
			}
			req := api.DownloadRequest{URL: args[0], Kind: "video", MaxHeight: maxHeight}
			if audio {
				req.Kind = "audio"
				if mp3 {
					req.AudioFormat = "mp3"
				}
			}
			return a.download(cmd, req, "", out, force, false, quiet)
		},
	}
	f := cmd.Flags()
	f.StringVarP(&out, "output", "o", "", "file or directory to write to (default: current directory)")
	f.BoolVar(&audio, "audio", false, "download the audio track only")
	f.BoolVar(&mp3, "mp3", false, "convert the audio to MP3 (implies --audio)")
	f.IntVarP(&maxHeight, "max-height", "H", 0, "highest video height, e.g. 720")
	f.BoolVarP(&force, "force", "f", false, "overwrite an existing file")
	f.BoolVarP(&quiet, "quiet", "q", false, "no progress; print only the saved path")
	return cmd
}

func fallbackName(req api.DownloadRequest) string {
	switch {
	case req.AudioFormat == "mp3":
		return "nah-download.mp3"
	case req.Kind == "audio":
		return "nah-download.m4a"
	}
	return "nah-download.mp4"
}

// download runs one download, prints the outcome and records it in the history.
func (a *app) download(cmd *cobra.Command, req api.DownloadRequest, title, out string, force, unique, quiet bool) error {
	c, err := a.client()
	if err != nil {
		return usageErr(err)
	}
	opts := tui.DownloadOptions{Client: c, Request: req, Dest: out, Fallback: fallbackName(req), Force: force, Unique: unique}

	// No overall timeout: a large file may take minutes. Ctrl+C cancels.
	var res tui.DownloadResult
	if a.env.StderrTTY && !a.jsonOut && !quiet {
		res, err = tui.RunDownload(cmd.Context(), a.env.Err, opts)
	} else {
		res, err = tui.RunDownloadPlain(cmd.Context(), a.env.Err, opts, quiet || a.jsonOut)
	}
	if err != nil {
		return err
	}
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(res.Path), filepath.Ext(res.Path))
	}
	if _, herr := a.history().Add(history.Entry{URL: req.URL, Title: title, Kind: req.Kind, MaxHeight: req.MaxHeight, AudioFormat: req.AudioFormat, Path: res.Path, Bytes: res.Bytes}); herr != nil {
		a.printErrln(ui.MutedText.Render("  (could not update the download history: " + herr.Error() + ")"))
	}
	if a.jsonOut {
		return a.printJSON(map[string]any{"path": res.Path, "bytes": res.Bytes, "provider": res.Provider, "elapsedMs": res.Elapsed.Milliseconds()})
	}
	if quiet {
		a.println(res.Path)
		return nil
	}
	a.printf("%s saved %s %s\n", ui.OK.Render("✓"), ui.Bold.Render(res.Path),
		ui.MutedText.Render(fmt.Sprintf("(%s in %s, via %s)", ui.Bytes(res.Bytes), res.Elapsed.Round(100e6), res.Provider)))
	return nil
}
