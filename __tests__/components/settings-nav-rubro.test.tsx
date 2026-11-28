/** The rubro change has a fixed place in Configuración, not only inside the onboarding wizard. */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SettingsNav } from "@/components/configuracion/settings-nav"

describe("SettingsNav", () => {
  it("links to Rubro from the Operación section", () => {
    render(<SettingsNav />)
    expect(screen.getByRole("link", { name: /Rubro/ })).toHaveAttribute("href", "/configuracion/rubro")
  })
})
