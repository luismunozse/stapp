import { describe, it, expect } from "vitest"
import {
  classifyDormantOrg,
  DORMANT_DAYS,
  ARCHIVE_GRACE_DAYS,
} from "@/lib/dormancy"

const now = new Date("2026-06-16T00:00:00Z")
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000)

describe("classifyDormantOrg", () => {
  it("does nothing for a non-eligible org (ever paid)", () => {
    expect(
      classifyDormantOrg({ eligible: false, activeRecently: false, warnedAt: null, now })
    ).toBe("none")
  })

  it("warns an eligible, dormant, not-yet-warned org", () => {
    expect(
      classifyDormantOrg({ eligible: true, activeRecently: false, warnedAt: null, now })
    ).toBe("warn")
  })

  it("does nothing for an eligible org that is still active", () => {
    expect(
      classifyDormantOrg({ eligible: true, activeRecently: true, warnedAt: null, now })
    ).toBe("none")
  })

  it("reprieves a warned org that became active again", () => {
    expect(
      classifyDormantOrg({
        eligible: true,
        activeRecently: true,
        warnedAt: daysAgo(20),
        now,
      })
    ).toBe("reprieve")
  })

  it("reprieves a warned org that is no longer eligible (started paying)", () => {
    expect(
      classifyDormantOrg({
        eligible: false,
        activeRecently: false,
        warnedAt: daysAgo(20),
        now,
      })
    ).toBe("reprieve")
  })

  it("archives a warned, still-dormant org past the grace window", () => {
    expect(
      classifyDormantOrg({
        eligible: true,
        activeRecently: false,
        warnedAt: daysAgo(ARCHIVE_GRACE_DAYS),
        now,
      })
    ).toBe("archive")
  })

  it("waits while a warned org is still inside the grace window", () => {
    expect(
      classifyDormantOrg({
        eligible: true,
        activeRecently: false,
        warnedAt: daysAgo(ARCHIVE_GRACE_DAYS - 1),
        now,
      })
    ).toBe("none")
  })

  it("exposes a 90-day dormancy threshold and a 14-day grace", () => {
    expect(DORMANT_DAYS).toBe(90)
    expect(ARCHIVE_GRACE_DAYS).toBe(14)
  })
})
