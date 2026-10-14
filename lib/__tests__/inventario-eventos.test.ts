// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// The audit log and the outbound webhooks of an inventory item, shared by the single-item
// routes (create, update, archive) and the group save. The routes used to carry these
// payloads inline; this file pins them so the group save emits exactly the same events.

const { auditoria, createAuditLogger } = vi.hoisted(() => {
  const auditoria = { create: vi.fn(), update: vi.fn(), delete: vi.fn() }
  return { auditoria, createAuditLogger: vi.fn(() => auditoria) }
})

vi.mock("@/lib/audit", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/audit")>()),
  createAuditLogger,
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))

import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import {
  AUDITED_FIELDS,
  pickAudited,
  registrarCreacion,
  registrarActualizacion,
  registrarArchivado,
} from "@/lib/inventario-eventos"

const request = new Request("http://localhost:3000/api/inventario", { method: "PUT" })
const ctx = { organizationId: "org-1", userId: "user-1", request }

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "i1",
  codigo: "FX-1",
  nombre: "Funda X - Rojo",
  descripcion: "Funda",
  categoria: "Fundas",
  tipo_dispositivo: "CELULAR",
  precio_compra: 300,
  precio_venta: 900,
  proveedor: "Acme",
  proveedor_id: "p1",
  stock_minimo: 1,
  stock_maximo: 10,
  punto_reorden: 2,
  barcode: "7790001",
  ubicacion: "A1",
  stock: 5,
  deleted_at: null,
  imagen_url: null,
  grupo_id: "g1",
  atributos: [{ opcion: "Color", valor: "Rojo" }],
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  auditoria.create.mockResolvedValue(undefined)
  auditoria.update.mockResolvedValue(undefined)
  auditoria.delete.mockResolvedValue(undefined)
  vi.mocked(emitWebhookEvent).mockResolvedValue(undefined)
})

describe("pickAudited", () => {
  it("keeps exactly the 14 audited fields", () => {
    expect(AUDITED_FIELDS).toHaveLength(14)
    expect(Object.keys(pickAudited(fila()))).toEqual([...AUDITED_FIELDS])
    expect(pickAudited(fila())).toEqual({
      codigo: "FX-1", nombre: "Funda X - Rojo", descripcion: "Funda", categoria: "Fundas", tipo_dispositivo: "CELULAR",
      precio_compra: 300, precio_venta: 900, proveedor: "Acme", proveedor_id: "p1", stock_minimo: 1, stock_maximo: 10,
      punto_reorden: 2, barcode: "7790001", ubicacion: "A1",
    })
  })

  it("does not audit stock, photos, archive state or the group link", () => {
    const keys = Object.keys(pickAudited(fila()))
    for (const fuera of ["stock", "imagen_url", "deleted_at", "grupo_id", "atributos"]) expect(keys).not.toContain(fuera)
  })
})

describe("registrarCreacion", () => {
  it("writes the CREATE audit entry and the inventario.created webhook", () => {
    registrarCreacion(ctx, fila())

    expect(createAuditLogger).toHaveBeenCalledWith("org-1", "user-1", request)
    expect(auditoria.create).toHaveBeenCalledWith("inventario", "i1", {
      codigo: "FX-1", nombre: "Funda X - Rojo", categoria: "Fundas", tipo_dispositivo: "CELULAR", stock: 5,
      precio_compra: 300, precio_venta: 900, proveedor_id: "p1", barcode: "7790001",
    })
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1)
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "inventario.created", {
      id: "i1", codigo: "FX-1", nombre: "Funda X - Rojo", categoria: "Fundas", tipoDispositivo: "CELULAR", stock: 5,
      precioVenta: 900, precioCompra: 300, proveedorId: "p1", barcode: "7790001",
    })
  })

  it("without a user it skips the audit entry but still sends the webhook", () => {
    registrarCreacion({ ...ctx, userId: null }, fila())
    expect(auditoria.create).not.toHaveBeenCalled()
    expect(createAuditLogger).not.toHaveBeenCalled()
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1)
  })

})

/**
 * A rejected promise as a mock result. It is NOT a `Promise` instance on purpose: @vitest/spy
 * attaches its own handlers to every Promise a mock returns, which would mark the rejection
 * as handled behind our back and hide a missing `.catch` in the code under test. The real
 * promise inside is unhandled unless the code calls `.catch`/`.then` on this object.
 */
function rechazoReal(motivo: Error) {
  const p = Promise.reject(motivo)
  return { then: p.then.bind(p), catch: p.catch.bind(p) }
}

// Callers that must not answer before the events are out (a serverless runtime may cut off
// what is still pending) pass `esperar`: every audit entry and webhook the helper starts
// is pushed there as a promise that never rejects.
describe("ctx.esperar: the promises of the events the helper started", () => {
  it("registrarCreacion pushes the audit entry and the webhook, and they settle", async () => {
    const esperar: Promise<unknown>[] = []
    registrarCreacion({ ...ctx, esperar }, fila())
    expect(esperar).toHaveLength(2)
    await expect(Promise.all(esperar)).resolves.toBeDefined()
  })

  it("without a user only the webhook is pushed", () => {
    const esperar: Promise<unknown>[] = []
    registrarCreacion({ ...ctx, userId: null, esperar }, fila())
    expect(esperar).toHaveLength(1)
  })

  it("registrarActualizacion pushes two promises when it emits and none when nothing changed", () => {
    const esperar: Promise<unknown>[] = []
    expect(registrarActualizacion({ ...ctx, esperar }, fila(), fila({ precio_venta: 1200 }))).toBe(true)
    expect(esperar).toHaveLength(2)
    expect(registrarActualizacion({ ...ctx, esperar }, fila(), fila())).toBe(false)
    expect(esperar).toHaveLength(2)
  })

  it("registrarArchivado pushes the audit entry and the webhook (only the webhook without a user)", () => {
    const esperar: Promise<unknown>[] = []
    registrarArchivado({ ...ctx, esperar }, fila())
    expect(esperar).toHaveLength(2)
    registrarArchivado({ ...ctx, userId: null, esperar }, fila())
    expect(esperar).toHaveLength(3)
  })

  it.each([
    ["registrarCreacion", (esperar: Promise<unknown>[]) => registrarCreacion({ ...ctx, esperar }, fila()), "create"],
    ["registrarActualizacion", (esperar: Promise<unknown>[]) => registrarActualizacion({ ...ctx, esperar }, fila(), fila({ precio_venta: 1 })), "update"],
    ["registrarArchivado", (esperar: Promise<unknown>[]) => registrarArchivado({ ...ctx, esperar }, fila()), "delete"],
  ] as const)("%s: the pushed promises never reject, whatever fails", async (_nombre, correr, metodo) => {
    auditoria[metodo].mockRejectedValue(new Error("audit down"))
    vi.mocked(emitWebhookEvent).mockRejectedValue(new Error("webhook down"))
    const esperar: Promise<unknown>[] = []
    correr(esperar)
    expect(esperar).toHaveLength(2)
    await expect(Promise.all(esperar)).resolves.toBeDefined()
  })

  it("a pushed promise stays pending until its audit entry or webhook settles", async () => {
    let terminar!: () => void
    vi.mocked(emitWebhookEvent).mockImplementation((() => new Promise<void>((r) => (terminar = r))) as never)
    const esperar: Promise<unknown>[] = []
    registrarCreacion({ ...ctx, userId: null, esperar }, fila())
    let listo = false
    void esperar[0].then(() => (listo = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(listo).toBe(false)
    terminar()
    await esperar[0]
    expect(listo).toBe(true)
  })

  it("without esperar nothing is collected and the helpers behave as before", () => {
    expect(() => registrarCreacion(ctx, fila())).not.toThrow()
    expect(auditoria.create).toHaveBeenCalledTimes(1)
  })
})

/** Runs `fn` and returns the promise rejections nobody handled while it flushed. */
async function rechazosSinManejar(fn: () => void): Promise<unknown[]> {
  const vistos: unknown[] = []
  const oyente = (razon: unknown) => void vistos.push(razon)
  process.on("unhandledRejection", oyente)
  try {
    fn()
    // unhandledRejection fires after the microtask queue drains: give it a few macrotasks.
    await new Promise((r) => setTimeout(r, 25))
  } finally {
    process.off("unhandledRejection", oyente)
  }
  return vistos
}

// The events are fire-and-forget: a failing audit or webhook must never surface (an unhandled
// rejection can take down a serverless invocation). Each helper is run with the audit failing,
// the webhook failing, and both failing; the helper must still have TRIED both.
describe.each([
  ["registrarCreacion", () => registrarCreacion(ctx, fila()), "create"],
  ["registrarActualizacion", () => registrarActualizacion(ctx, fila(), fila({ precio_venta: 1200 })), "update"],
  ["registrarArchivado", () => registrarArchivado(ctx, fila()), "delete"],
] as const)("%s swallows failures of the audit and of the webhook", (_nombre, correr, metodoAuditoria) => {
  it.each([
    ["the audit entry rejects", true, false],
    ["the webhook rejects", false, true],
    ["both reject", true, true],
  ])("%s: nothing escapes", async (_caso, falla, fallaWebhook) => {
    if (falla) auditoria[metodoAuditoria].mockImplementation(() => rechazoReal(new Error("audit down")))
    if (fallaWebhook) vi.mocked(emitWebhookEvent).mockImplementation((() => rechazoReal(new Error("webhook down"))) as never)

    const sinManejar = await rechazosSinManejar(() => expect(correr).not.toThrow())

    expect(sinManejar).toEqual([])
    expect(auditoria[metodoAuditoria]).toHaveBeenCalledTimes(1)
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it("the harness does see an unhandled rejection (so the checks above are not vacuous)", async () => {
    const sinManejar = await rechazosSinManejar(() => void Promise.reject(new Error("unhandled on purpose")))
    expect(sinManejar).toHaveLength(1)
  })
})

describe("registrarActualizacion", () => {
  it("a price edit is one UPDATE audit entry and one inventario.updated with only the diff", () => {
    const emitido = registrarActualizacion(ctx, fila(), fila({ precio_venta: 1200 }))

    expect(emitido).toBe(true)
    expect(auditoria.update).toHaveBeenCalledTimes(1)
    const [entidad, id, antes, despues] = auditoria.update.mock.calls[0]
    expect(entidad).toBe("inventario")
    expect(id).toBe("i1")
    expect(antes).toEqual(pickAudited(fila()))
    expect(despues).toEqual(pickAudited(fila({ precio_venta: 1200 })))
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1)
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "inventario.updated", {
      id: "i1", codigo: "FX-1", nombre: "Funda X - Rojo",
      changes: { precio_venta: { before: 900, after: 1200 } },
    })
  })

  it("lists every changed field, before and after", () => {
    registrarActualizacion(ctx, fila(), fila({ nombre: "Funda Y - Rojo", codigo: "FY-1", barcode: null }))
    // The top-level identity of the event is the row AFTER the edit: the new code, the new name.
    expect(vi.mocked(emitWebhookEvent).mock.calls[0][2]).toMatchObject({
      id: "i1",
      codigo: "FY-1",
      nombre: "Funda Y - Rojo",
      changes: {
        nombre: { before: "Funda X - Rojo", after: "Funda Y - Rojo" },
        codigo: { before: "FX-1", after: "FY-1" },
        barcode: { before: "7790001", after: null },
      },
    })
  })

  it("an identical row emits nothing", () => {
    expect(registrarActualizacion(ctx, fila(), fila())).toBe(false)
    expect(auditoria.update).not.toHaveBeenCalled()
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })

  it("a change outside the audited fields (stock, photo, archive, group link) emits nothing", () => {
    const despues = fila({ stock: 9, imagen_url: "x.jpg", deleted_at: "2026-10-13", grupo_id: null, atributos: null })
    expect(registrarActualizacion(ctx, fila(), despues)).toBe(false)
    expect(auditoria.update).not.toHaveBeenCalled()
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })

  it("without a user it emits nothing at all, like the single-item route", () => {
    expect(registrarActualizacion({ ...ctx, userId: null }, fila(), fila({ precio_venta: 1 }))).toBe(false)
    expect(auditoria.update).not.toHaveBeenCalled()
    expect(emitWebhookEvent).not.toHaveBeenCalled()
  })
})

describe("registrarArchivado", () => {
  it("writes the DELETE audit entry marked ARCHIVADO and the inventario.archived webhook", () => {
    registrarArchivado(ctx, fila())

    expect(auditoria.delete).toHaveBeenCalledWith("inventario", "i1", { ...pickAudited(fila()), accion: "ARCHIVADO" })
    expect(emitWebhookEvent).toHaveBeenCalledWith("org-1", "inventario.archived", {
      id: "i1", codigo: "FX-1", nombre: "Funda X - Rojo", archivedBy: "user-1",
    })
  })

  it.each([null, undefined])("without a user (%s) the webhook says archivedBy null and there is no audit entry", (userId) => {
    registrarArchivado({ ...ctx, userId }, fila())
    expect(auditoria.delete).not.toHaveBeenCalled()
    expect(vi.mocked(emitWebhookEvent).mock.calls[0][2]).toHaveProperty("archivedBy", null)
  })
})
