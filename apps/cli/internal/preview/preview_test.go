package preview

import (
	"bytes"
	"context"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

var sgr = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func solid(w, h int, c color.Color) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	return img
}

func TestSizeKeepsTheProportionsInsideTheBox(t *testing.T) {
	cases := []struct {
		w, h, mc, mr int
		cols, rows   int
	}{
		{1280, 720, 44, 12, 42, 12}, // 16:9: the height (24 px) is the limit, so 42 columns
		{720, 1280, 44, 12, 13, 12}, // vertical video is limited by the height
		{100, 100, 40, 10, 20, 10},  // square: 20 x 20 px
		{10, 10, 44, 12, 24, 12},    // small images are scaled up to fill the box
		{1000, 10, 44, 12, 44, 1},   // a very flat banner keeps at least one row
		{0, 10, 44, 12, 0, 0},
	}
	for _, c := range cases {
		cols, rows := Size(c.w, c.h, c.mc, c.mr)
		if cols != c.cols || rows != c.rows {
			t.Errorf("%dx%d in %dx%d: got %dx%d want %dx%d", c.w, c.h, c.mc, c.mr, cols, rows, c.cols, c.rows)
		}
		if cols > c.mc || rows > c.mr {
			t.Errorf("%dx%d overflows the box", c.w, c.h)
		}
	}
}

func TestRenderDrawsHalfBlocksWithTheTopPixelAsForegroundAndTheBottomAsBackground(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			if y < 2 {
				img.Set(x, y, color.RGBA{255, 0, 0, 255}) // top half red
			} else {
				img.Set(x, y, color.RGBA{0, 0, 255, 255}) // bottom half blue
			}
		}
	}
	lines, cols, rows := Render(img, 4, 2, termenv.TrueColor)
	if cols != 4 || rows != 2 || len(lines) != 2 {
		t.Fatalf("%d x %d, %d lines", cols, rows, len(lines))
	}
	// row 0 covers pixel rows 0-1 (all red), row 1 covers rows 2-3 (all blue)
	if !strings.Contains(lines[0], "38;2;255;0;0") || !strings.Contains(lines[0], "48;2;255;0;0") {
		t.Fatalf("row 0 should be red on red: %q", lines[0])
	}
	if !strings.Contains(lines[1], "38;2;0;0;255") {
		t.Fatalf("row 1 should be blue: %q", lines[1])
	}
	for _, l := range lines {
		if w := lipgloss.Width(l); w != cols {
			t.Fatalf("line is %d wide, want %d", w, cols)
		}
		if !strings.HasSuffix(l, "\x1b[0m") {
			t.Fatal("every row must reset its colours or they would bleed into the next line")
		}
	}
}

func TestRenderIsCompactForFlatAreas(t *testing.T) {
	lines, cols, _ := Render(solid(64, 36, color.RGBA{10, 20, 30, 255}), 40, 10, termenv.TrueColor)
	if n := len(sgr.FindAllString(lines[0], -1)); n > 3 {
		t.Fatalf("a flat row must not repeat the same colour for each of its %d cells (%d sequences)", cols, n)
	}
}

func TestRenderFallsBackToABrightnessRampWithoutColour(t *testing.T) {
	lines, cols, rows := Render(solid(20, 20, color.White), 10, 5, termenv.Ascii)
	if len(lines) != rows || strings.Contains(strings.Join(lines, ""), "\x1b") || len(lines[0]) != cols {
		t.Fatalf("%q", lines)
	}
	dark, _, _ := Render(solid(20, 20, color.Black), 10, 5, termenv.Ascii)
	if lines[0] == dark[0] {
		t.Fatal("white and black must not look the same")
	}
}

func TestTransparentImagesAreDrawnOverBlack(t *testing.T) {
	lines, _, _ := Render(solid(8, 8, color.NRGBA{255, 255, 255, 0}), 4, 2, termenv.TrueColor)
	if !strings.Contains(lines[0], "38;2;0;0;0") {
		t.Fatalf("a fully transparent image is black, not white: %q", lines[0])
	}
}

func serve(t *testing.T, ctype string, body []byte, status int) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", ctype)
		w.WriteHeader(status)
		w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func encode(t *testing.T, format string) []byte {
	var buf bytes.Buffer
	img := solid(32, 18, color.RGBA{200, 100, 50, 255})
	var err error
	if format == "png" {
		err = png.Encode(&buf, img)
	} else {
		err = jpeg.Encode(&buf, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestFetchDecodesJpegAndPng(t *testing.T) {
	for _, f := range []string{"png", "jpeg"} {
		img, err := Fetch(context.Background(), nil, serve(t, "image/"+f, encode(t, f), 200))
		if err != nil || img.Bounds().Dx() != 32 || img.Bounds().Dy() != 18 {
			t.Fatalf("%s: %v", f, err)
		}
	}
}

func TestFetchRefusesWhatItShould(t *testing.T) {
	ctx := context.Background()
	if _, err := Fetch(ctx, nil, "file:///etc/passwd"); err == nil {
		t.Fatal("only http(s)")
	}
	if _, err := Fetch(ctx, nil, "javascript:alert(1)"); err == nil {
		t.Fatal("only http(s)")
	}
	if _, err := Fetch(ctx, nil, serve(t, "text/html", []byte("<html>nope</html>"), 200)); err == nil {
		t.Fatal("not an image")
	}
	if _, err := Fetch(ctx, nil, serve(t, "image/png", encode(t, "png"), 404)); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("HTTP errors are reported: %v", err)
	}
	if _, err := Fetch(ctx, nil, serve(t, "image/jpeg", bytes.Repeat([]byte{0xff}, maxBytes+10), 200)); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("oversized body: %v", err)
	}
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := Fetch(cctx, nil, serve(t, "image/png", encode(t, "png"), 200)); err == nil {
		t.Fatal("cancelled")
	}
}

// bombPNG is a valid PNG header that claims an enormous size: decoding it would allocate gigabytes.
func bombPNG(w, h uint32) []byte {
	var b bytes.Buffer
	b.Write([]byte("\x89PNG\r\n\x1a\n"))
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 6 // 8-bit RGBA
	chunk := append([]byte("IHDR"), ihdr...)
	binary.Write(&b, binary.BigEndian, uint32(13))
	b.Write(chunk)
	binary.Write(&b, binary.BigEndian, crc32.ChecksumIEEE(chunk))
	return b.Bytes()
}

func TestADecompressionBombIsRefusedBeforeItIsDecoded(t *testing.T) {
	if _, err := Decode(bombPNG(30000, 30000)); err == nil || !strings.Contains(err.Error(), "out of range") {
		t.Fatalf("%v", err)
	}
	if _, err := Decode(bombPNG(9000, 9000)); err == nil {
		t.Fatal("81 million pixels is too many")
	}
}
