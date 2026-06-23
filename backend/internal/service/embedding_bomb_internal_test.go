// Internal test (package service) for the decompression-bomb guard.
// image.Decode allocates W*H*4 bytes up front from header-declared dimensions,
// so absurd sizes must be rejected by reading only the header (DecodeConfig)
// before any full decode.
package service

import "testing"

func TestExceedsPixelCap(t *testing.T) {
	cases := []struct {
		name string
		w, h int
		want bool
	}{
		{"typical 12MP phone photo", 4032, 3024, false},
		{"large 24MP photo", 6000, 4000, false},
		{"decompression-bomb dims", 20000, 20000, true},
		{"zero width", 0, 500, true},
		{"negative height", 100, -1, true},
	}
	for _, c := range cases {
		if got := exceedsPixelCap(c.w, c.h); got != c.want {
			t.Errorf("%s: exceedsPixelCap(%d,%d) = %v, want %v", c.name, c.w, c.h, got, c.want)
		}
	}
}
