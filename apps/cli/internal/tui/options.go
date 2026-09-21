package tui

import (
	"fmt"
	"sort"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/ui"
)

// dlOption is one thing the person can ask for, in plain words: "Best quality", "720p", "Audio only", "MP3".
type dlOption struct {
	Label    string
	Detail   string
	Req      api.DownloadRequest
	Fallback string
	// LinkURL is the direct link of the closest rendition, for "copy link".
	LinkURL string
	MP3     bool
}

// buildOptions turns the technical list of variants into the short menu people actually want. The gateway can
// merge video and audio and cap the height, so the choices are: the best, each available height, and audio.
func buildOptions(m api.Media) []dlOption {
	var opts []dlOption
	src := m.SourceURL

	var videos, audios []api.Variant
	for _, v := range m.Variants {
		switch v.Kind {
		case "video":
			videos = append(videos, v)
		case "audio":
			audios = append(audios, v)
		}
	}

	if len(videos) > 0 {
		opts = append(opts, dlOption{Label: "Best quality", Detail: "video + audio",
			Req: api.DownloadRequest{URL: src, Kind: "video"}, Fallback: "nah-download.mp4", LinkURL: videos[0].URL})

		best := map[int]api.Variant{} // one entry per height: the one with the largest known size
		for _, v := range videos {
			if v.Height <= 0 {
				continue
			}
			if cur, ok := best[v.Height]; !ok || v.SizeBytes > cur.SizeBytes {
				best[v.Height] = v
			}
		}
		heights := make([]int, 0, len(best))
		for h := range best {
			heights = append(heights, h)
		}
		sort.Sort(sort.Reverse(sort.IntSlice(heights)))
		for _, h := range heights {
			v := best[h]
			ext := v.Ext
			if ext == "" {
				ext = "mp4"
			}
			detail := ext
			if v.SizeBytes > 0 {
				detail += " · ~" + ui.Bytes(v.SizeBytes)
			}
			opts = append(opts, dlOption{Label: fmt.Sprintf("%dp", h), Detail: detail,
				Req: api.DownloadRequest{URL: src, Kind: "video", MaxHeight: h}, Fallback: "nah-download.mp4", LinkURL: v.URL})
		}
	}

	if len(audios) > 0 || len(videos) > 0 {
		link := ""
		if len(audios) > 0 {
			link = audios[0].URL
		} else {
			link = videos[0].URL
		}
		opts = append(opts,
			dlOption{Label: "Audio only", Detail: "original quality", Req: api.DownloadRequest{URL: src, Kind: "audio"}, Fallback: "nah-download.m4a", LinkURL: link},
			dlOption{Label: "MP3", Detail: "converted audio", Req: api.DownloadRequest{URL: src, Kind: "audio", AudioFormat: "mp3"}, Fallback: "nah-download.mp3", LinkURL: link, MP3: true},
		)
	}
	return opts
}
