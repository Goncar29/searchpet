package config

import "testing"

// IsProduction is the single definition of "is this a production deployment?".
//
// Before it existed the predicate was spelled three different ways — two
// case-sensitive (`environment == "production"`) and one case-insensitive —
// so `ENVIRONMENT=Production` produced a deployment that was production for
// one subsystem and development for the others. A predicate that disagrees
// with itself cannot be reasoned about, which is the whole reason this is a
// function and not a comparison repeated at each call site.

func TestIsProduction_ReconoceProduccionSinImportarMayusculas(t *testing.T) {
	cases := []struct {
		environment string
		want        bool
	}{
		{"production", true},
		// Case folding is the point: an operator typing Production must not
		// silently get development behaviour in a production deployment.
		{"Production", true},
		{"PRODUCTION", true},
		{"ProDuCtIoN", true},

		{"development", false},
		{"Development", false},
		{"test", false},
		{"staging", false},
		{"", false},
		// "prod" is deliberately NOT production. Accepting abbreviations means
		// guessing which ones, and a guess that is wrong in the permissive
		// direction turns a typo into a silently degraded deployment. The
		// contract is: set ENVIRONMENT=production, any spelling of the word.
		{"prod", false},
		// Whitespace is not trimmed here on purpose: this predicate answers
		// one question and does not repair its input.
		{" production", false},
	}

	for _, tc := range cases {
		t.Run(tc.environment, func(t *testing.T) {
			if got := IsProduction(tc.environment); got != tc.want {
				t.Errorf("IsProduction(%q) = %v, want %v", tc.environment, got, tc.want)
			}
		})
	}
}

// TestIsProduction_NoEsSubstring guards the lazy implementation. A
// strings.Contains-based check would pass every case above while also
// matching values that merely mention the word, so the cases that matter are
// the ones no correct implementation accepts.
func TestIsProduction_NoEsSubstring(t *testing.T) {
	for _, environment := range []string{
		"production-like",
		"pre-production",
		"not-production",
		"productionish",
	} {
		if IsProduction(environment) {
			t.Errorf("IsProduction(%q) = true; only the exact word is production", environment)
		}
	}
}
