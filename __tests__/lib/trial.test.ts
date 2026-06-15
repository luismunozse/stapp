import { describe, it, expect } from "vitest"
import {
  exceedsTrialCap,
  computeNewTrialEnd,
  TRIAL_NET_EXTENSION_CAP_DAYS,
} from "@/lib/trial"

describe("exceedsTrialCap", () => {
  it("allows an extension that stays under the cap", () => {
    expect(exceedsTrialCap(30, 30)).toBe(false)
  })

  it("allows an extension that lands exactly on the cap", () => {
    expect(exceedsTrialCap(60, TRIAL_NET_EXTENSION_CAP_DAYS - 60)).toBe(false)
  })

  it("blocks an extension that exceeds the cap", () => {
    expect(exceedsTrialCap(TRIAL_NET_EXTENSION_CAP_DAYS, 1)).toBe(true)
  })

  it("never blocks a shortening (negative delta), even past the cap", () => {
    expect(exceedsTrialCap(120, -30)).toBe(false)
  })

  it("never blocks a zero delta", () => {
    expect(exceedsTrialCap(TRIAL_NET_EXTENSION_CAP_DAYS, 0)).toBe(false)
  })
})

describe("computeNewTrialEnd", () => {
  const now = new Date("2026-06-15T00:00:00Z")

  it("extends from a future trial_end", () => {
    const trialEnd = new Date("2026-06-20T00:00:00Z")
    const result = computeNewTrialEnd(trialEnd, 5, now)
    expect(result.toISOString()).toBe("2026-06-25T00:00:00.000Z")
  })

  it("extends from now when there is no trial_end", () => {
    const result = computeNewTrialEnd(null, 7, now)
    expect(result.toISOString()).toBe("2026-06-22T00:00:00.000Z")
  })

  it("extends from now when trial_end is already in the past", () => {
    const trialEnd = new Date("2026-06-01T00:00:00Z")
    const result = computeNewTrialEnd(trialEnd, 3, now)
    expect(result.toISOString()).toBe("2026-06-18T00:00:00.000Z")
  })

  it("shortens with a negative delta", () => {
    const trialEnd = new Date("2026-06-20T00:00:00Z")
    const result = computeNewTrialEnd(trialEnd, -5, now)
    expect(result.toISOString()).toBe("2026-06-15T00:00:00.000Z")
  })
})
