import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Wrench } from "lucide-react"
import { StatusPill, STATUS_TONE_CLASSES } from "@/components/ui/status-pill"
import { OrderStatusBadge, PaymentStatusBadge, badgeVariants } from "@/components/ui/badge"
import { STATUS_TONES } from "@/lib/status-tone"

describe("StatusPill", () => {
  it("pinta el tono soft (texto 700 sobre fondo tintado) y el ícono oculto al lector", () => {
    const { container } = render(
      <StatusPill tone="orange" icon={Wrench}>
        En reparación
      </StatusPill>
    )
    const pill = screen.getByText("En reparación")
    expect(pill).toHaveAttribute("data-tone", "orange")
    expect(pill.className).toContain("text-orange-700")
    expect(pill.className).toContain("bg-orange-50")
    expect(pill.className).toContain("dark:text-orange-300")
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("todos los tonos tienen texto, fondo, borde y punto", () => {
    for (const tone of STATUS_TONES) {
      const c = STATUS_TONE_CLASSES[tone]
      expect(c.text && c.bg && c.border && c.dot, tone).toBeTruthy()
    }
  })
})

describe("Badge", () => {
  it("ningún estado de orden usa texto blanco sobre relleno 500", () => {
    for (const estado of ["recibido", "presupuestado", "reparado", "entregado_sin_reparacion", "entregado_sin_cobro", "sin_falla_detectada"] as const) {
      const cls = badgeVariants({ variant: estado })
      expect(cls, estado).not.toContain("text-white")
      expect(cls, estado).not.toMatch(/(^|\s)bg-[a-z]+-500(\s|$)/)
    }
  })

  it("usa focus-visible y no las clases muertas success-400/info-400", () => {
    const cls = badgeVariants({ variant: "successSoft" }) + badgeVariants({ variant: "infoSoft" })
    expect(cls).toContain("focus-visible:ring-2")
    expect(cls).not.toMatch(/(^|\s)focus:/)
    expect(cls).not.toContain("success-400")
    expect(cls).not.toContain("info-400")
  })

  it("OrderStatusBadge toma etiqueta y tono de lib/estado-orden-ui", () => {
    render(<OrderStatusBadge status="EN_REPARACION" />)
    const badge = screen.getByText("En reparación")
    expect(badge.className).toContain("text-orange-700")
  })

  it("PaymentStatusBadge usa variantes soft", () => {
    render(<PaymentStatusBadge status="PAGADO" />)
    expect(screen.getByText("Cobrado").className).toContain("text-success-700")
  })
})
