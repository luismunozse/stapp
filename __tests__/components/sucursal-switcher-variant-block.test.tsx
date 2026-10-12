/**
 * Tests: SucursalSwitcher — the `block` variant used by the mobile drawer.
 *
 * The desktop variant is a compact pill sized for a crowded top-right bar: a
 * `py-1` trigger with the branch name clamped to `max-w-[110px]`. Dropping that
 * same pill into the drawer would hand a phone user a ~26px tall tap target
 * (WCAG asks for 44) and a branch name cut mid-word, which is the one piece of
 * information the control exists to show.
 *
 * So `block` is a real variant, not a styling whim. Both shapes are asserted
 * here because the whole point is that they differ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } }, status: "authenticated" }),
}))

import { SucursalSwitcher } from "@/components/layout/sucursal-switcher"

const SUCURSALES = [
  { id: "suc-A", nombre: "Casa Central", principal: true },
  { id: "suc-B", nombre: "Sucursal Norte Ruta 8", principal: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: SUCURSALES }) })) as any
})

const trigger = async () => {
  const button = await screen.findByRole("button")
  return button
}

describe("SucursalSwitcher — block variant", () => {
  it("fills the drawer row and meets the 44px tap target", async () => {
    render(<SucursalSwitcher variant="block" />)

    await waitFor(async () => {
      const button = await trigger()
      expect(button.className).toContain("w-full")
      expect(button.className).toContain("touch-target")
    })
  })

  it("lets the branch name use the row instead of clamping it to 110px", async () => {
    render(<SucursalSwitcher variant="block" />)
    const button = await trigger()

    const label = button.querySelector("span")
    expect(label!.className).toContain("flex-1")
    expect(label!.className).not.toContain("max-w-[110px]")
  })

  it("keeps the compact pill as the default, for the desktop bar", async () => {
    render(<SucursalSwitcher />)

    await waitFor(async () => {
      const button = await trigger()
      expect(button.className).toContain("rounded-full")
      expect(button.className).not.toContain("w-full")
      expect(button.querySelector("span")!.className).toContain("max-w-[110px]")
    })
  })
})
