// The numbers the "How points and badges work" popup shows (web and mobile).
//
// The backend decides what is paid; these constants only MIRROR it so the copy
// is written once. If a backend value changes, change it here too. Where each
// number comes from (backend/internal/service/gamification_service.go unless
// noted; function names, not line numbers, so the references do not rot):
//
//   POINTS.report         onReportCreated: Upsert(reporter, 5, "total_reports")
//                         fired by every `report.created`, except the closing
//                         "found" report of the pet's own owner or stray
//                         reporter (isOwnClosure)
//   POINTS.share          onShareCreated: Upsert(user, 2, "share_count")
//                         fired by shareLinkService.Generate, paid once per
//                         (pet, user): PetShareCreditRepository.CreditOnce
//   POINTS.helper         helperAwardPoints = 100, paid by onPetHelpersCredited
//                         once per pet: unique (pet, helper) index
//   POINTS.reviewReceived onReviewCreated: Upsert(reviewee, 10, "")
//                         onReviewDeleted gives it back, floored at 0 by
//                         GREATEST(points + delta, 0) in
//                         repository/user_points_repository.go
//   BADGE_THRESHOLDS.communityGuardianReports  onReportCreated: TotalReports >= 10
//   BADGE_THRESHOLDS.superFinderPets           onPetHelpersCredited: credits >= 5
//
// Owner marking their own pet found pays nothing: "pet.found" has no
// gamification listener (RegisterListeners), and the owner's own "found"
// report is skipped by isOwnClosure.

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
