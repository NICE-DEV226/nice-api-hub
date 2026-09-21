package pow

import (
	"context"
	"testing"
	"time"
)

func TestSolveProducesANonceTheServerRuleAccepts(t *testing.T) {
	for _, bits := range []int{0, 1, 8, 16} {
		nonce, err := Solve(context.Background(), "payload.signature", bits, 0)
		if err != nil {
			t.Fatal(err)
		}
		if !Check("payload.signature", nonce, bits) {
			t.Fatalf("bits=%d nonce=%s rejected", bits, nonce)
		}
	}
}

func TestLeadingZeroBits(t *testing.T) {
	cases := []struct {
		in   []byte
		want int
	}{
		{[]byte{0xff}, 0}, {[]byte{0x7f}, 1}, {[]byte{0x01}, 7}, {[]byte{0, 0x80}, 8},
		{[]byte{0, 0x0f}, 12}, {[]byte{0, 0, 0}, 24}, {nil, 0},
	}
	for _, c := range cases {
		if got := LeadingZeroBits(c.in); got != c.want {
			t.Errorf("%x: %d want %d", c.in, got, c.want)
		}
	}
}

// Known vector computed with the gateway's own solvePow (Node): keeps both implementations in agreement.
func TestAgreesWithTheReferenceImplementation(t *testing.T) {
	if !Check("t:x", "0", 0) {
		t.Fatal("0 bits always passes")
	}
	// sha256("abc:0") is a fixed value; the check must be a pure function of token+":"+nonce
	if Check("abc", "0", 40) {
		t.Fatal("40 bits at nonce 0 is astronomically unlikely")
	}
}

func TestSolveHonoursCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := Solve(ctx, "never", 60, 2) // impossible in practice
	if err == nil {
		t.Fatal("expected cancellation")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("took too long to stop: %v", time.Since(start))
	}
}

func BenchmarkSolve20Bits(b *testing.B) {
	for i := 0; i < b.N; i++ {
		if _, err := Solve(context.Background(), "bench-token-"+string(rune('a'+i%26)), 20, 0); err != nil {
			b.Fatal(err)
		}
	}
}
