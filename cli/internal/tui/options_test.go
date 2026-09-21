package tui

import (
	"reflect"
	"strings"
	"testing"

	"github.com/NICE-DEV226/nice-api-hub/cli/internal/api"
)

func labels(opts []dlOption) []string {
	out := make([]string, len(opts))
	for i, o := range opts {
		out[i] = o.Label
	}
	return out
}

func TestOptionsListTheBestEachHeightAndAudio(t *testing.T) {
	yes := true
	m := api.Media{SourceURL: "https://youtu.be/x", Variants: []api.Variant{
		{Kind: "video", Height: 720, Ext: "mp4", SizeBytes: 50_000_000, URL: "https://cdn/720-video-only"},
		{Kind: "video", Height: 1080, Ext: "mp4", SizeBytes: 120_000_000, URL: "https://cdn/1080"},
		{Kind: "video", Height: 1080, Ext: "mp4", SizeBytes: 90_000_000, URL: "https://cdn/1080-b"},
		{Kind: "video", Height: 480, Ext: "webm", HasAudio: &yes, URL: "https://cdn/480"},
		{Kind: "audio", Ext: "m4a", URL: "https://cdn/audio"},
	}}
	opts := buildOptions(m)
	if got := labels(opts); !reflect.DeepEqual(got, []string{"Best quality", "1080p", "720p", "480p", "Audio only", "MP3"}) {
		t.Fatalf("%v", got)
	}
	if o := opts[0]; o.Req.Kind != "video" || o.Req.MaxHeight != 0 || o.Req.URL != m.SourceURL {
		t.Fatalf("best: %+v", o.Req)
	}
	if o := opts[1]; o.Req.MaxHeight != 1080 || !strings.HasPrefix(o.Detail, "mp4 · ~") {
		t.Fatalf("1080p: %+v", o)
	}
	if opts[1].LinkURL != "https://cdn/1080" {
		t.Fatal("copy-link uses the largest rendition of that height")
	}
	if o := opts[3]; o.Detail != "webm" {
		t.Fatalf("no size known: just the format, got %q", o.Detail)
	}
	if o := opts[5]; !o.MP3 || o.Req.Kind != "audio" || o.Req.AudioFormat != "mp3" || o.Fallback != "nah-download.mp3" {
		t.Fatalf("mp3: %+v", o)
	}
}

func TestPlatformsWithoutHeightsStillOfferBestAndAudio(t *testing.T) {
	m := api.Media{SourceURL: "https://tiktok.com/x", Variants: []api.Variant{
		{Kind: "video", Quality: "hd", URL: "https://cdn/hd"}, {Kind: "video", Quality: "sd", URL: "https://cdn/sd"}, {Kind: "audio", URL: "https://cdn/a"}}}
	if got := labels(buildOptions(m)); !reflect.DeepEqual(got, []string{"Best quality", "Audio only", "MP3"}) {
		t.Fatalf("%v", got)
	}
}

func TestAudioOnlyMediaHasNoVideoOptions(t *testing.T) {
	m := api.Media{SourceURL: "https://soundcloud.com/x", Variants: []api.Variant{{Kind: "audio", URL: "https://cdn/a"}}}
	if got := labels(buildOptions(m)); !reflect.DeepEqual(got, []string{"Audio only", "MP3"}) {
		t.Fatalf("%v", got)
	}
}

func TestNothingToDownloadMeansNoOptions(t *testing.T) {
	if got := buildOptions(api.Media{SourceURL: "https://x"}); len(got) != 0 {
		t.Fatalf("%v", got)
	}
}
