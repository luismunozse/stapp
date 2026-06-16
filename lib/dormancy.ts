/**
 * Pure decision logic for the dormant-org auto-archive lifecycle. Kept free of
 * DB/IO so the policy can be unit-tested in isolation; the cron
 * (app/api/cron/auto-archive-dormant) feeds it values pulled from Supabase.
 *
 * Policy (conservative):
 *   - Only orgs that NEVER paid (Free) are eligible.
 *   - Dormant = no activity for DORMANT_DAYS days.
 *   - First a warning email is sent; after ARCHIVE_GRACE_DAYS more days of
 *     continued dormancy, the org is soft-archived (recoverable).
 *   - Any activity (or starting to pay) before archival cancels it.
 */

/** Days with no activity before an org is considered dormant. */
export const DORMANT_DAYS = 90

/** Days of continued dormancy after the warning before auto-archiving. */
export const ARCHIVE_GRACE_DAYS = 14

export type DormancyAction = "warn" | "archive" | "reprieve" | "none"

export interface DormancyInput {
  /** True only for orgs that never paid (Free). */
  eligible: boolean
  /** True if the org had any activity within the dormancy window. */
  activeRecently: boolean
  /** When the archival warning was sent, or null if never warned. */
  warnedAt: Date | null
  /** Current time. */
  now: Date
}

/**
 * Decides what the cron should do with a single org this run. Returns:
 *  - "warn": eligible + dormant + never warned → send warning, stamp warnedAt.
 *  - "reprieve": was warned but came back (active again) or started paying →
 *    clear warnedAt, leave the org alone.
 *  - "archive": was warned, still dormant, and the grace window has elapsed.
 *  - "none": nothing to do (active, not eligible, or still inside grace).
 */
export function classifyDormantOrg(
  input: DormancyInput,
  graceDays: number = ARCHIVE_GRACE_DAYS
): DormancyAction {
  const { eligible, activeRecently, warnedAt, now } = input

  if (warnedAt) {
    // A previously-warned org gets reprieved the moment it's no longer a
    // candidate — it came back, or it started paying.
    if (!eligible || activeRecently) return "reprieve"

    const daysSinceWarned = (now.getTime() - warnedAt.getTime()) / 86400000
    return daysSinceWarned >= graceDays ? "archive" : "none"
  }

  // Never warned: warn only an eligible org that is currently dormant.
  if (eligible && !activeRecently) return "warn"
  return "none"
}
