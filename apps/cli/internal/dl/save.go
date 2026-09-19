// Package dl saves a download stream to disk safely and reports progress.
package dl

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/NICE-DEV226/nice-api-hub/apps/cli/internal/api"
)

// Progress is called with the bytes written so far and the total (-1 if unknown).
type Progress func(done, total int64)

// ErrExists is returned when the destination exists and force is false.
var ErrExists = errors.New("destination already exists (use --force to overwrite)")

// ResolvePath decides where to write. dest may be empty (current dir), an existing directory,
// or a file path. The name comes from the gateway when dest is a directory.
func ResolvePath(dest, suggested, fallback string) string {
	name := SafeName(suggested, fallback) // never trust a name chosen by a remote server
	if dest == "" {
		return filepath.Join(".", name)
	}
	if st, err := os.Stat(dest); err == nil && st.IsDir() {
		return filepath.Join(dest, name)
	}
	if strings.HasSuffix(dest, string(os.PathSeparator)) {
		return filepath.Join(dest, name)
	}
	return dest
}

// Save streams s to the resolved path, via a ".part" file renamed on success. It never
// leaves a partial file behind on failure or cancellation.
func Save(ctx context.Context, s *api.DownloadStream, dest, fallbackName string, force bool, onProgress Progress) (string, int64, error) {
	return save(ctx, s, dest, fallbackName, force, false, onProgress)
}

// SaveUnique is Save for interactive use: when the name is taken it saves "name (2).ext" instead of failing.
func SaveUnique(ctx context.Context, s *api.DownloadStream, dest, fallbackName string, onProgress Progress) (string, int64, error) {
	return save(ctx, s, dest, fallbackName, false, true, onProgress)
}

func save(ctx context.Context, s *api.DownloadStream, dest, fallbackName string, force, unique bool, onProgress Progress) (string, int64, error) {
	path := ResolvePath(dest, s.Filename, fallbackName)
	if unique {
		path = Unique(path)
	}
	if !force && !unique {
		if _, err := os.Stat(path); err == nil {
			return path, 0, fmt.Errorf("%s: %w", path, ErrExists)
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return path, 0, err
	}
	part := path + ".part"
	f, err := os.OpenFile(part, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return path, 0, err
	}
	cleanup := func() { f.Close(); os.Remove(part) }

	n, err := copyWithProgress(ctx, f, s.Body, s.ContentLength, onProgress)
	if err != nil {
		cleanup()
		return path, n, err
	}
	if s.ContentLength > 0 && n != s.ContentLength {
		cleanup()
		return path, n, fmt.Errorf("incomplete download: got %d of %d bytes", n, s.ContentLength)
	}
	if err := f.Close(); err != nil {
		os.Remove(part)
		return path, n, err
	}
	if err := os.Rename(part, path); err != nil {
		os.Remove(part)
		return path, n, err
	}
	return path, n, nil
}

func copyWithProgress(ctx context.Context, dst io.Writer, src io.Reader, total int64, onProgress Progress) (int64, error) {
	buf := make([]byte, 128*1024)
	var done int64
	last := time.Time{}
	for {
		if err := ctx.Err(); err != nil {
			return done, err
		}
		n, rerr := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return done, werr
			}
			done += int64(n)
			if onProgress != nil && time.Since(last) >= 100*time.Millisecond {
				last = time.Now()
				onProgress(done, total)
			}
		}
		if rerr == io.EOF {
			if onProgress != nil {
				onProgress(done, total)
			}
			return done, nil
		}
		if rerr != nil {
			if ctx.Err() != nil {
				return done, ctx.Err()
			}
			return done, rerr
		}
	}
}
