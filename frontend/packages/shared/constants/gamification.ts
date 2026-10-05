// The numbers the "How points and badges work" popup shows (web and mobile).
//
// The backend decides what is paid; these constants only MIRROR it so the copy
// is written once. If a backend value changes, change it here too. Where each
// number comes from (backend/internal/service):
//
//   POINTS.report         gamification_service.go:118  Upsert(reporter, 5, "total_reports")
//                         fired by every `report.created` (report_service.go:308,
//                         pet_service.go:314 stray, pet_service.go:827 publish-lost)
//   POINTS.share          gamification_service.go:151  Upsert(user, 2, "share_count")
//                         fired by shareLinkService.Generate (share_service.go:89)
//   POINTS.helper         gamification_service.go:65   helperAwardPoints = 100
//                         once per pet: unique (pet, helper) index, helper_confirmation.go
//   POINTS.reviewReceived gamification_service.go:172  Upsert(reviewee, 10, "")
//                         review.deleted gives it back: gamification_service.go:190,
//                         floored at 0 by GREATEST(points + delta, 0) in
//                         repository/user_points_repository.go:48
//   BADGE_THRESHOLDS.communityGuardianReports  gamification_service.go:133  TotalReports >= 10
//   BADGE_THRESHOLDS.superFinderPets           gamification_service.go:98   credits >= 5
//
// Owner marking their own pet found pays nothing: "pet.found" has no gamification
// listener (gamification_service.go:54-57).

export const POINTS = {
  report: 5,
  share: 2,
  helper: 100,
  reviewReceived: 10,
} as const;

export const BADGE_THRESHOLDS = {
  communityGuardianReports: 10,
  superFinderPets: 5,
} as const;
