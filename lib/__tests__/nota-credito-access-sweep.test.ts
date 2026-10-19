import { describe, it, expect } from "vitest"
import { join } from "path"
import { handlersDe } from "./sweep-utils"

// Barrido de acceso de las notas de crédito (spec, "Tests"). Nace con la
// anulación de ventas (PR4) y su primera fila; el PR7 suma la emisión con el
// flag del vendedor, el listado y las rutas de órdenes.
const DEVOLUCION_DIR = join(process.cwd(), "app", "api", "ventas", "[id]", "devolucion")

// Anular revierte plata, stock y cuenta corriente: solo el ADMIN (spec, Permisos).
const RESERVADOS_AL_ADMIN = new Set(["[devolucionId]/anular/route.ts POST"])

describe("barrido de acceso — notas de crédito de venta", () => {
  const handlers = handlersDe(DEVOLUCION_DIR)

  it("anular existe y es solo del ADMIN", () => {
    const reservados = handlers.filter((h) => RESERVADOS_AL_ADMIN.has(`${h.id} ${h.metodo}`))
    expect(reservados).toHaveLength(RESERVADOS_AL_ADMIN.size)
    for (const h of reservados) expect(h.body, `${h.id} ${h.metodo}`).toMatch(/\brequireAdmin\(\)/)
  })

  it("ningún handler de la devolución queda sin guard", () => {
    expect(handlers.length).toBeGreaterThan(0)
    for (const h of handlers) expect(h.body, `${h.id} ${h.metodo}`).toMatch(/\brequire(Admin|PosAccess|Auth)\(\)/)
  })
})
