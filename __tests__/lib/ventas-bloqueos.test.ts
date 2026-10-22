// __tests__/lib/ventas-bloqueos.test.ts
/**
 * What stops a venta from being annulled, edited or deleted while it carries
 * fiscal comprobantes. The API pre-check repeats what the database enforces
 * (trigger P0022 on annulment, editar RPC P0021) with the SAME text, so the user
 * never sees two different explanations.
 *
 * Rows are told apart by `cbte_tipo`: 8 / 13 are credit notes (NC), anything else
 * (6 / 11, or NULL on legacy rows) is a factura. An NC never blocks an annulment.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  RELACIONES_BLOQUEO_VENTA,
  mensajeBloqueoSql,
  motivoNoAnulable,
  motivoNoEditable,
  motivoNoEliminable,
} from "@/lib/ventas/bloqueos"

// The exact text of the trigger proteger_anulacion_venta (migration 371), without the code prefix.
const MSG_ANULAR_FACTURA =
  'La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica.'
const MSG_REMITO_VIGENTE = "La venta tiene un remito vigente: anulalo primero desde Facturación."

const factura = (estado: string, extra: Record<string, unknown> = {}) => ({
  id: `f-${estado}`,
  estado,
  cbte_tipo: 6,
  ...extra,
})
const notaCredito = (estado: string, cbteTipo = 8) => ({ id: `nc-${estado}`, estado, cbte_tipo: cbteTipo })
const conComprobantes = (...comprobantes: unknown[]) => ({ id: "v1", comprobantes_fiscales: comprobantes })

describe("RELACIONES_BLOQUEO_VENTA", () => {
  it("trae cbte_tipo de los comprobantes: es lo que separa una nota de credito de una factura", () => {
    expect(RELACIONES_BLOQUEO_VENTA).toContain("comprobantes_fiscales(id, estado, cbte_tipo)")
  })

  it("sigue trayendo el resto de las relaciones que deciden", () => {
    for (const rel of ["facturas(id, estado_pago)", "devoluciones_venta(id)", "notas_credito(id, anulada)", "inventario_series(id)"]) {
      expect(RELACIONES_BLOQUEO_VENTA).toContain(rel)
    }
  })

  it("no pide columnas de la migracion 371: la ruta de la venta no puede depender de ella", () => {
    for (const col of ["comprobante_asociado_id", "anulado_at", "cbte_nro_solicitado", "motivo"]) {
      expect(RELACIONES_BLOQUEO_VENTA).not.toContain(col)
    }
  })
})

describe("motivoNoAnulable", () => {
  it.each(["emitido", "pendiente"])("una factura %s bloquea y manda a 'Anular factura'", (estado) => {
    expect(motivoNoAnulable(conComprobantes(factura(estado)))).toBe(MSG_ANULAR_FACTURA)
  })

  it("el texto ya no manda a emitir una nota de credito a mano en ARCA", () => {
    const motivo = motivoNoAnulable(conComprobantes(factura("emitido")))!
    expect(motivo).toContain('"Anular factura"')
    expect(motivo).not.toMatch(/nota de crédito en ARCA/)
    expect(motivo).not.toMatch(/Registrá la devolución/)
  })

  it("factura anulada + nota de credito emitida: se puede anular la venta", () => {
    expect(motivoNoAnulable(conComprobantes(factura("anulado"), notaCredito("emitido")))).toBeNull()
  })

  it.each(["anulado", "rechazado"])("una factura %s sola no bloquea", (estado) => {
    expect(motivoNoAnulable(conComprobantes(factura(estado)))).toBeNull()
  })

  it("factura #1 anulada + factura #2 emitida: la segunda bloquea", () => {
    expect(motivoNoAnulable(conComprobantes(factura("anulado"), notaCredito("emitido"), factura("emitido", { id: "f2" })))).toBe(
      MSG_ANULAR_FACTURA
    )
  })

  it("nota de credito pendiente con la factura original todavia emitida: la original bloquea", () => {
    expect(motivoNoAnulable(conComprobantes(factura("emitido"), notaCredito("pendiente")))).toBe(MSG_ANULAR_FACTURA)
  })

  it.each([
    ["B emitida", notaCredito("emitido", 8)],
    ["C emitida", notaCredito("emitido", 13)],
    ["B pendiente", notaCredito("pendiente", 8)],
    ["C pendiente", notaCredito("pendiente", 13)],
  ])("una nota de credito %s nunca bloquea por si sola", (_n, nc) => {
    expect(motivoNoAnulable(conComprobantes(nc))).toBeNull()
  })

  it("una fila legada sin cbte_tipo es una factura: bloquea", () => {
    expect(motivoNoAnulable(conComprobantes({ id: "legacy", estado: "emitido" }))).toBe(MSG_ANULAR_FACTURA)
    expect(motivoNoAnulable(conComprobantes({ id: "legacy", estado: "emitido", cbte_tipo: null }))).toBe(MSG_ANULAR_FACTURA)
  })

  it("un remito vigente sigue bloqueando con su mensaje de siempre", () => {
    expect(motivoNoAnulable({ facturas: [{ id: "r", estado_pago: "PAGADO" }] })).toBe(MSG_REMITO_VIGENTE)
    expect(motivoNoAnulable({ facturas: [{ id: "r", estado_pago: "ANULADA" }] })).toBeNull()
  })

  it("con factura emitida Y remito vigente se explica primero la factura (mismo orden que el trigger)", () => {
    expect(
      motivoNoAnulable({ ...conComprobantes(factura("emitido")), facturas: [{ id: "r", estado_pago: "PAGADO" }] })
    ).toBe(MSG_ANULAR_FACTURA)
  })

  it("la nota de credito emitida no tapa un remito vigente", () => {
    expect(
      motivoNoAnulable({ ...conComprobantes(factura("anulado"), notaCredito("emitido")), facturas: [{ id: "r", estado_pago: "PAGADO" }] })
    ).toBe(MSG_REMITO_VIGENTE)
  })

  it("sin comprobantes (o con una forma inesperada) no bloquea", () => {
    expect(motivoNoAnulable({})).toBeNull()
    expect(motivoNoAnulable(null)).toBeNull()
    expect(motivoNoAnulable({ comprobantes_fiscales: [] })).toBeNull()
    // PostgREST puede devolver un objeto suelto en una relacion 1:1.
    expect(motivoNoAnulable({ comprobantes_fiscales: factura("emitido") })).toBe(MSG_ANULAR_FACTURA)
  })
})

describe("motivoNoEditable", () => {
  const MSG_FACTURA = "La venta tiene una factura electrónica emitida."

  it.each(["emitido", "pendiente"])("una factura %s bloquea (texto de siempre)", (estado) => {
    expect(motivoNoEditable(conComprobantes(factura(estado)))).toBe(MSG_FACTURA)
  })

  it("factura emitida con una nota de credito pendiente: explica la factura, no la NC", () => {
    expect(motivoNoEditable(conComprobantes(factura("emitido"), notaCredito("pendiente")))).toBe(MSG_FACTURA)
  })

  it("factura #1 anulada + factura #2 emitida: la segunda bloquea con el texto de la factura", () => {
    expect(motivoNoEditable(conComprobantes(factura("anulado"), notaCredito("emitido"), factura("emitido", { id: "f2" })))).toBe(
      MSG_FACTURA
    )
  })

  // Desde la migracion 372 editar_venta_atomica cuenta solo FACTURAS: una venta con la factura
  // anulada y su nota de credito electronica se puede editar (el pre-check ya no la bloquea).
  it.each([
    ["emitida", "emitido"],
    ["pendiente", "pendiente"],
  ])("factura anulada + nota de credito %s: no bloquea (la nota de credito no cuenta)", (_n, estadoNc) => {
    expect(motivoNoEditable(conComprobantes(factura("anulado"), notaCredito(estadoNc)))).toBeNull()
  })

  it("una nota de credito sola (cualquier estado, B o C) no bloquea", () => {
    expect(motivoNoEditable(conComprobantes(notaCredito("emitido", 8)))).toBeNull()
    expect(motivoNoEditable(conComprobantes(notaCredito("pendiente", 13)))).toBeNull()
  })

  it("las notas de credito internas siguen bloqueando con su propio texto", () => {
    expect(motivoNoEditable({ notas_credito: [{ id: "n1", anulada: false }] })).toBe("La venta tiene una nota de crédito.")
  })

  it("una nota de credito rechazada (o una factura anulada o rechazada) no bloquea", () => {
    expect(motivoNoEditable(conComprobantes(factura("anulado"), notaCredito("rechazado")))).toBeNull()
    expect(motivoNoEditable(conComprobantes(factura("anulado")))).toBeNull()
    expect(motivoNoEditable(conComprobantes(factura("rechazado")))).toBeNull()
  })

  it("la nota de credito emitida no tapa un remito: se explica el remito", () => {
    expect(
      motivoNoEditable({ ...conComprobantes(factura("anulado"), notaCredito("emitido")), facturas: [{ id: "r", estado_pago: "PAGADO" }] })
    ).toBe("La venta tiene un remito generado.")
  })

  it("el resto de los bloqueos no cambia", () => {
    expect(motivoNoEditable({ facturas: [{ id: "r", estado_pago: "PAGADO" }] })).toBe("La venta tiene un remito generado.")
    expect(motivoNoEditable({ devoluciones_venta: [{ id: "d" }] })).toBe("La venta tiene devoluciones registradas.")
    expect(motivoNoEditable({ comision_pagada: true })).toBe("La comisión de esta venta ya se liquidó al vendedor.")
    expect(motivoNoEditable({ inventario_series: [{ id: "s" }] })).toBe("La venta tiene productos con número de serie.")
    expect(motivoNoEditable({})).toBeNull()
  })
})

describe("motivoNoEliminable", () => {
  const MSG_FACTURA = "La venta tiene una factura electrónica emitida."

  it.each(["emitido", "pendiente"])("una factura %s bloquea con el texto de siempre", (estado) => {
    expect(motivoNoEliminable(conComprobantes(factura(estado)))).toBe(MSG_FACTURA)
  })

  it("factura anulada + nota de credito emitida: tampoco se borra (la numeracion fiscal queda)", () => {
    expect(motivoNoEliminable(conComprobantes(factura("anulado"), notaCredito("emitido")))).toMatch(/numeración/)
  })

  it.each([
    ["una factura anulada sola", [factura("anulado")]],
    ["una nota de credito emitida sola", [notaCredito("emitido")]],
    ["una nota de credito pendiente sola", [notaCredito("pendiente")]],
    ["una NC C emitida sola", [notaCredito("emitido", 13)]],
  ])("%s bloquea", (_n, comprobantes) => {
    expect(motivoNoEliminable(conComprobantes(...comprobantes))).not.toBeNull()
  })

  it("factura #1 anulada + NC emitida + factura #2 emitida: bloquea con el texto de la factura", () => {
    expect(motivoNoEliminable(conComprobantes(factura("anulado"), notaCredito("emitido"), factura("emitido", { id: "f2" })))).toBe(
      MSG_FACTURA
    )
  })

  it("solo intentos rechazados (de factura o de nota de credito): no bloquean, la ruta los borra", () => {
    expect(motivoNoEliminable(conComprobantes(factura("rechazado")))).toBeNull()
    expect(motivoNoEliminable(conComprobantes(factura("rechazado"), notaCredito("rechazado")))).toBeNull()
    expect(motivoNoEliminable(conComprobantes(notaCredito("rechazado")))).toBeNull()
  })

  it("una nota de credito rechazada junto a una factura anulada: la anulada sigue bloqueando", () => {
    expect(motivoNoEliminable(conComprobantes(factura("anulado"), notaCredito("rechazado")))).not.toBeNull()
  })

  it("el remito sigue bloqueando con su mensaje", () => {
    expect(motivoNoEliminable({ facturas: [{ id: "r", estado_pago: "ANULADA" }] })).toBe(
      "La venta tiene un remito: borrarla perdería su numeración."
    )
  })

  it("sin comprobantes no bloquea", () => {
    expect(motivoNoEliminable({})).toBeNull()
    expect(motivoNoEliminable(null)).toBeNull()
  })
})

describe("mensajeBloqueoSql", () => {
  it("saca el prefijo tecnico del trigger y deja el texto igual al del pre-check", () => {
    expect(mensajeBloqueoSql(`VENTA_NO_ANULABLE: ${MSG_ANULAR_FACTURA}`)).toBe(MSG_ANULAR_FACTURA)
    expect(mensajeBloqueoSql("VENTA_NO_EDITABLE: La venta tiene un remito generado.")).toBe("La venta tiene un remito generado.")
    expect(mensajeBloqueoSql(undefined)).toBe("")
  })
})

describe("el pre-check de la API dice lo mismo que la base de datos", () => {
  // Una deriva entre el texto del trigger y el de la API dejaria dos explicaciones
  // distintas para lo mismo segun quien lo frene primero.
  const dir = path.join(process.cwd(), "supabase", "migrations")
  const archivo = readdirSync(dir).find((f) => f.endsWith("_anular_factura_arca.sql"))

  it("la migracion de la anulacion existe", () => {
    expect(archivo).toBeDefined()
  })

  it("el mensaje de motivoNoAnulable es el del trigger proteger_anulacion_venta", () => {
    const sql = readFileSync(path.join(dir, archivo!), "utf8")
    expect(sql).toContain(`VENTA_NO_ANULABLE: ${MSG_ANULAR_FACTURA}`)
    expect(motivoNoAnulable(conComprobantes(factura("emitido")))).toBe(MSG_ANULAR_FACTURA)
  })
})
