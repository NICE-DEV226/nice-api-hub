// Package preview fetches a media thumbnail and draws it in the terminal with half blocks.
//
// Each character cell shows two pixels, one above the other ("▀" with the top pixel as the foreground colour and
// the bottom pixel as the background). That works in every terminal with colour, over SSH, inside tmux, and needs
// no graphics protocol.
package preview

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"  // decoders
	_ "image/jpeg" // decoders
	_ "image/png"  // decoders
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/muesli/termenv"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // decoder
)

const (
	maxBytes  = 8 << 20 // a thumbnail is a few dozen kB; refuse anything absurd
	maxPixels = 40_000_000
	maxSide   = 10_000
)

// Fetch downloads and decodes the image at url. It refuses non-http(s) links, huge bodies, and images whose
// declared size would need gigabytes of memory to decode.
func Fetch(ctx context.Context, client *http.Client, url string) (image.Image, error) {
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return nil, errors.New("thumbnail is not an http(s) link")
	}
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "image/webp,image/jpeg,image/png,image/*;q=0.8")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; nah-preview)")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("thumbnail: HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxBytes {
		return nil, errors.New("thumbnail is too large")
	}
	return Decode(body)
}

// Decode decodes an image, checking its declared size before allocating for it.
func Decode(b []byte) (image.Image, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > maxSide || cfg.Height > maxSide || cfg.Width*cfg.Height > maxPixels {
		return nil, fmt.Errorf("thumbnail dimensions %dx%d are out of range", cfg.Width, cfg.Height)
	}
	img, _, err := image.Decode(bytes.NewReader(b))
	return img, err
}

// Size returns the cells (columns, rows) Render would use for an image of w×h pixels inside maxCols×maxRows.
func Size(w, h, maxCols, maxRows int) (cols, rows int) {
	if w <= 0 || h <= 0 || maxCols <= 0 || maxRows <= 0 {
		return 0, 0
	}
	pxW, pxH := maxCols, maxRows*2 // a cell is one pixel wide and two tall
	scale := float64(pxW) / float64(w)
	if s := float64(pxH) / float64(h); s < scale {
		scale = s
	}
	cols = maxInt(1, int(float64(w)*scale))
	rows = maxInt(1, int(float64(h)*scale+0.5)/2)
	if rows*2 > pxH {
		rows = pxH / 2
	}
	return cols, rows
}

// Render draws img inside at most maxCols×maxRows cells, keeping its proportions, and returns one string per row
// together with the size actually used. profile decides how colours are written; with no colour at all (NO_COLOR,
// a dumb terminal) it falls back to a brightness ramp.
func Render(img image.Image, maxCols, maxRows int, profile termenv.Profile) (lines []string, cols, rows int) {
	b := img.Bounds()
	cols, rows = Size(b.Dx(), b.Dy(), maxCols, maxRows)
	if cols == 0 {
		return nil, 0, 0
	}
	// scale onto an opaque black canvas so transparent PNGs do not turn into garbage
	dst := image.NewRGBA(image.Rect(0, 0, cols, rows*2))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.Black), image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Over, nil)

	lines = make([]string, rows)
	for r := 0; r < rows; r++ {
		var sb strings.Builder
		var prevFG, prevBG string
		for x := 0; x < cols; x++ {
			top, bot := dst.RGBAAt(x, r*2), dst.RGBAAt(x, r*2+1)
			if profile == termenv.Ascii {
				sb.WriteByte(ramp(top, bot))
				continue
			}
			fg, bg := seq(profile, top, false), seq(profile, bot, true)
			if fg != prevFG {
				sb.WriteString(fg)
				prevFG = fg
			}
			if bg != prevBG {
				sb.WriteString(bg)
				prevBG = bg
			}
			sb.WriteString("▀")
		}
		if profile != termenv.Ascii {
			sb.WriteString("\x1b[0m")
		}
		lines[r] = sb.String()
	}
	return lines, cols, rows
}

func seq(p termenv.Profile, c color.RGBA, bg bool) string {
	hex := "#" + h2(c.R) + h2(c.G) + h2(c.B)
	return "\x1b[" + p.Color(hex).Sequence(bg) + "m"
}

func h2(v uint8) string {
	s := strconv.FormatUint(uint64(v), 16)
	if len(s) == 1 {
		return "0" + s
	}
	return s
}

func ramp(top, bot color.RGBA) byte {
	const chars = " .:-=+*#%@"
	lum := func(c color.RGBA) float64 { return 0.2126*float64(c.R) + 0.7152*float64(c.G) + 0.0722*float64(c.B) }
	v := (lum(top) + lum(bot)) / 2 / 255
	i := int(v * float64(len(chars)-1))
	return chars[i]
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
