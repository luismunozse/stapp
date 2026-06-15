/**
 * Pure helpers for superadmin trial adjustments (extend / shorten / remove).
 * Kept side-effect free so the cap + date math can be unit tested without
 * mocking Supabase. The route (app/api/superadmin/trial-extension) wires these
 * to the DB.
 */

/**
 * Maximum NET cumulative trial extension per organization, in days. The cap is
 * computed against SUM(dias_extendidos) in `trial_extensions` so that repeated
 * small extensions can't grant an unbounded free trial. Shortening (negative
 * deltas) reduces the sum and is never blocked.
 */
export const TRIAL_NET_EXTENSION_CAP_DAYS = 90

/**
 * Returns true if applying `deltaDias` would push the net cumulative extension
 * past the cap. Only positive deltas (extensions) can be blocked; shortening or
 * removing a trial is always allowed.
 */
export function exceedsTrialCap(
  existingSumDias: number,
  deltaDias: number,
  cap: number = TRIAL_NET_EXTENSION_CAP_DAYS
): boolean {
  if (deltaDias <= 0) return false
  return existingSumDias + deltaDias > cap
}

/**
 * Computes the new trial end date after adding `deltaDias`. Extensions build on
 * the current trial_end when it is still in the future; otherwise they build on
 * `now` (re-opening an expired/absent trial). Negative deltas shorten it.
 */
export function computeNewTrialEnd(
  currentTrialEnd: Date | null,
  deltaDias: number,
  now: Date
): Date {
  const base =
    currentTrialEnd && currentTrialEnd.getTime() > now.getTime()
      ? new Date(currentTrialEnd)
      : new Date(now)
  base.setUTCDate(base.getUTCDate() + deltaDias)
  return base
}
