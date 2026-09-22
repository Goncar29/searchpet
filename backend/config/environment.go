package config

import "strings"

// productionEnvironment is the one value that means "this is production".
const productionEnvironment = "production"

// IsProduction is the single definition of "is this a production deployment?".
//
// It exists because the predicate used to be spelled three different ways:
// pkg/logger and internal/app compared with a case-sensitive `==`, while the
// mailer startup guard used a case-insensitive match. With
// ENVIRONMENT=Production that deployment was production for one subsystem and
// development for the others — the logger emitted console logs meant for a
// developer's terminal while the mailer enforced production rules. A predicate
// that disagrees with itself cannot be reasoned about.
//
// The match is case-insensitive, which is the safer of the two behaviours it
// unifies: an operator who types Production gets production everywhere rather
// than a deployment that is quietly half-configured. Abbreviations like "prod"
// are deliberately NOT accepted — accepting them means guessing which ones, and
// guessing permissively converts a typo into a silently degraded deployment.
//
// Callers that need "not production" should negate this rather than growing a
// second predicate; that second predicate is exactly what this replaced.
func IsProduction(environment string) bool {
	return strings.EqualFold(environment, productionEnvironment)
}
