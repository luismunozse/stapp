import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse } from "./helpers/sql-text"

// Contrato de la migración entrega-idempotente / reservas de cotización.
// No hay Postgres en CI: se fija lo que dice el SQL.

const SUFIJO = "_entrega_idempotente_y_reservas_cotizacion.sql"
const sql = readBySuffix(SUFIJO)
const limpio = collapse(sql)

/** Cuerpo ($$ ... $$) de la definición de `fn` en esta migración. */
function cuerpo(fn: string): string {
  const inicio = limpio.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`)
  expect(inicio, `${fn} se redefine en la migración`).toBeGreaterThan(-1)
  const abre = limpio.indexOf("$$", inicio)
  const cierra = limpio.indexOf("$$", abre + 2)
  return limpio.slice(abre + 2, cierra)
}

describe("un solo CARGO vigente por orden en cuenta corriente", () => {
  it("crea un índice único parcial sobre los CARGO de orden no revertidos", () => {
    expect(limpio).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS cuenta_corriente_cargo_orden_vigente_uniq ON cuenta_corriente \(organization_id, referencia_id\) WHERE tipo = 'CARGO' AND referencia_tipo = 'ORDEN' AND revertido_at IS NULL/
    )
  })

  it("aborta con el detalle si ya hay duplicados, antes de crear el índice", () => {
    const chequeo = limpio.indexOf("HAVING COUNT(*) > 1")
    const indice = limpio.indexOf("CREATE UNIQUE INDEX")
    expect(chequeo).toBeGreaterThan(-1)
    expect(chequeo).toBeLessThan(indice)
    expect(limpio).toMatch(/RAISE EXCEPTION 'MIGRACION_388/)
  })

  it("no abre su propia transacción", () => {
    expect(limpio).not.toMatch(/(^|;)\s*BEGIN\s*;/i)
    expect(limpio).not.toMatch(/\bCOMMIT\s*;/i)
  })
})

describe("liberar_items_cotizacion libera según el libro de la cotización", () => {
  const body = cuerpo("liberar_items_cotizacion")

  it("recorre lo pendiente de reserva_cotizacion_pendiente, no las líneas", () => {
    expect(body).toMatch(/FOR v_row IN SELECT \* FROM reserva_cotizacion_pendiente\(p_cotizacion_id\)/)
    expect(body).not.toMatch(/FROM items_cotizacion/)
    expect(body).not.toMatch(/LEAST\(v_item\.cantidad/)
  })

  it("asienta lo realmente liberado (idempotente)", () => {
    expect(body).toMatch(/'LIBERACION_RESERVA', v_cantidad_liberar/)
  })

  it("bloquea la cotización para serializar liberaciones", () => {
    const cabecera = body.slice(0, body.indexOf("FOR v_row"))
    expect(cabecera).toMatch(/FROM cotizaciones WHERE id = p_cotizacion_id FOR UPDATE/)
  })
})

describe("los UPDATE de inventario filtran por organización", () => {
  for (const [fn, org] of [
    ["liberar_items_cotizacion", "v_org_id"],
    ["reservar_items_cotizacion", "v_org_id"],
    ["reservar_stock_catalogo", "p_organization_id"],
  ] as const) {
    it(fn, () => {
      const body = cuerpo(fn)
      const updates = body.match(/UPDATE inventario SET [^;]*;/g) ?? []
      expect(updates.length).toBeGreaterThan(0)
      for (const u of updates) expect(u).toContain(`organization_id = ${org}`)

      const lecturas = body.match(/FROM inventario WHERE [^;]*?FOR UPDATE/g) ?? []
      expect(lecturas.length).toBeGreaterThan(0)
      for (const l of lecturas) expect(l).toContain(`organization_id = ${org}`)
    })
  }

  it("reservar_stock_catalogo también acota los UPDATE de catálogo", () => {
    const body = cuerpo("reservar_stock_catalogo")
    for (const u of body.match(/UPDATE catalogo_(items|variantes) SET [^;]*;/g) ?? []) {
      expect(u).toContain("organization_id = p_organization_id")
    }
  })
})

describe("rollback y probes", () => {
  it("el rollback quita el índice y restaura las tres funciones", () => {
    const rb = collapse(readByMarker("rollback", "Rollback of 388"))
    expect(rb).toMatch(/DROP INDEX IF EXISTS cuenta_corriente_cargo_orden_vigente_uniq/)
    for (const fn of ["liberar_items_cotizacion", "reservar_items_cotizacion", "reservar_stock_catalogo"]) {
      expect(rb).toContain(`CREATE OR REPLACE FUNCTION ${fn}(`)
    }
  })

  it("hay un precheck que lista los CARGO duplicados", () => {
    const pre = collapse(readByMarker("verify", "Pre-check of 388"))
    expect(pre).toMatch(/SET TRANSACTION READ ONLY/)
    expect(pre).toMatch(/HAVING COUNT\(\*\) > 1/)
  })

  it("los probes terminan en ROLLBACK", () => {
    const pr = collapse(readByMarker("verify", "Verification of 388"))
    expect(pr).toMatch(/ROLLBACK;\s*$/)
  })
})
