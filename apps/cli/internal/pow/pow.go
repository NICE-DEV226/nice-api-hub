// Package pow solves the gateway's registration challenge: find a nonce such that
// sha256(token + ":" + nonce) starts with `bits` zero bits. It uses every core.
package pow

import (
	"context"
	"crypto/sha256"
	"math/bits"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
)

// LeadingZeroBits counts the zero bits at the start of digest.
func LeadingZeroBits(digest []byte) int {
	n := 0
	for _, b := range digest {
		if b == 0 {
			n += 8
			continue
		}
		return n + bits.LeadingZeros8(b)
	}
	return n
}

// Check reports whether nonce solves the challenge.
func Check(token, nonce string, want int) bool {
	sum := sha256.Sum256([]byte(token + ":" + nonce))
	return LeadingZeroBits(sum[:]) >= want
}

// Solve returns a nonce for token. workers <= 0 means one per CPU. It stops early with ctx.Err() if cancelled.
func Solve(ctx context.Context, token string, want, workers int) (string, error) {
	if want <= 0 {
		return "0", nil
	}
	if workers <= 0 {
		workers = runtime.NumCPU()
	}
	var (
		found  atomic.Int64
		wg     sync.WaitGroup
		result = make(chan int64, workers)
	)
	found.Store(-1)
	prefix := []byte(token + ":")

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(start int64) {
			defer wg.Done()
			buf := make([]byte, 0, len(prefix)+20)
			for n := start; ; n += int64(workers) {
				// checking the flag on every hash would cost more than the hash itself
				if n&0x3ff == start&0x3ff && (found.Load() >= 0 || ctx.Err() != nil) {
					return
				}
				buf = strconv.AppendInt(append(buf[:0], prefix...), n, 10)
				sum := sha256.Sum256(buf)
				if LeadingZeroBits(sum[:]) >= want {
					if found.CompareAndSwap(-1, n) {
						result <- n
					}
					return
				}
			}
		}(int64(w))
	}
	wg.Wait()
	if err := ctx.Err(); err != nil && found.Load() < 0 {
		return "", err
	}
	return strconv.FormatInt(<-result, 10), nil
}
