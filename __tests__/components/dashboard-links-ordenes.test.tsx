/**
 * Los links del dashboard hacia /ordenes tienen que llevar params que la lista
 * entiende: antes usaban estado_cobro / estado=pendientes / href pelado y el
 * dueño veía un número en el dashboard y caía en la lista sin filtrar.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { render, screen } from "@testing-library/react"
import { buildAdminActions } from "@/components/dashboard/action-strip"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { parseOrdenesFiltros, serializeOrdenesFiltros } from "@/lib/ordenes/filtros-url"

/** El href, re-serializado tras pasar por el parser de la lista, queda igual: no se pierde nada. */
function entiendeLaLista(href: string) {
  const [pathname, qs = ""] = href.split("?")
  expect(pathname).toBe("/ordenes")
  expect(qs).not.toBe("")
  expect(serializeOrdenesFiltros(parseOrdenesFiltros(new URLSearchParams(qs))).toString()).toBe(qs)
}

describe("links del dashboard a la lista de órdenes", () => {
  it("action strip: cobros y fecha prometida vencida llegan filtrados", () => {
    const items = buildAdminActions({
      moneda: "ARS",
      cobrosCount: 2,
      deudaTotal: 1000,
      slaVencidasCount: 3,
      garantiasCount: 0,
      stockBajoCount: 0,
    })
    const href = (id: string) => items.find((i) => i.id === id)!.href
    expect(href("cobros")).toBe("/ordenes?filtro=pendientesCobro")
    expect(href("sla")).toBe("/ordenes?filtro=vencidas")
    entiendeLaLista(href("cobros"))
    entiendeLaLista(href("sla"))
  })

  it("quick actions: 'Ver Cobros Pendientes' llega filtrado", () => {
    render(<QuickActions cobrosPendientesCount={2} />)
    const link = screen.getByRole("link", { name: /Ver Cobros Pendientes/ })
    expect(link).toHaveAttribute("href", "/ordenes?filtro=pendientesCobro")
  })

  it("la página del dashboard no arma query strings a mano hacia /ordenes", () => {
    const src = readFileSync(path.join(process.cwd(), "app/(dashboard)/dashboard/page.tsx"), "utf8")
    expect(src).not.toMatch(/["'`]\/ordenes\?/)
    expect(src).toContain('ordenesHref({ filtro: "activas" })')
    expect(src).toContain('ordenesHref({ estado: "RECIBIDO" })')
    expect(src).toContain('ordenesHref({ estado: "ESPERANDO_REPUESTO" })')
  })
})
