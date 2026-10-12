import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(
  join(process.cwd(), "app/(dashboard)/dashboard/page.tsx"),
  "utf8"
)

describe("dashboard onboarding redirect", () => {
  const start = source.indexOf("onboarding_completed === false")
  const block = source.slice(start, start + 900)

  it("counts real orders through countRealOrders", () => {
    expect(start).toBeGreaterThan(-1)
    expect(source).toContain('from "@/lib/onboarding/practica"')
    expect(block).toContain("countRealOrders(")
  })

  it("no longer counts ordenes_servicio inline", () => {
    expect(block).not.toContain('.from("ordenes_servicio")')
  })
})
