import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

// Contrato de contabilidad de stock del catálogo público.
//
// `reservar_stock_catalogo` descontaba `inventario.stock` de una:
//   UPDATE inventario SET stock = GREATEST(0, stock - v_cantidad)
// Eso era contabilidad paralela — sin pasar por el detalle por depósito y sin
// asiento en `movimientos_inventario` — y ademas irreversible: nada devuelve
// ese stock si la solicitud se rechaza o se abandona. Si encima la cotización
// terminaba convertida en venta, `crear_venta_atomica` volvía a descontar y la
// unidad se iba dos veces.
//
// El catálogo ahora RESERVA (`stock_reservado`), igual que el flujo interno
// (`reservar_items_cotizacion`, migración 206): la conversión a venta libera la
// reserva y descuenta una sola vez por el camino de siempre.
//
// El chequeo es sobre el SQL fuente y no contra una base: las migraciones se
// aplican a mano y no hay Postgres en CI, así que este es el único lugar donde
// la regla se puede fijar de forma automática.

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations")

/** Última migración (por número) que redefine la función pedida. */
function ultimaDefinicion(fn: string): { archivo: string; cuerpo: string } {
  const archivos = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))

  const marca = `CREATE OR REPLACE FUNCTION ${fn}`
  let encontrado: { archivo: string; cuerpo: string } | null = null

  for (const archivo of archivos) {
    const sql = readFileSync(join(MIGRATIONS_DIR, archivo), "utf8")
    const inicio = sql.lastIndexOf(marca)
    if (inicio === -1) continue

    // Cuerpo = entre el `$$` de apertura y el `$$` de cierre.
    const abre = sql.indexOf("$$", inicio)
    const cierra = sql.indexOf("$$", abre + 2)
    encontrado = { archivo, cuerpo: sql.slice(abre + 2, cierra) }
  }

  if (!encontrado) throw new Error(`No hay definición de ${fn} en ${MIGRATIONS_DIR}`)
  return encontrado
}

describe("reservar_stock_catalogo — reserva, no descuenta", () => {
  const { archivo, cuerpo } = ultimaDefinicion("reservar_stock_catalogo")

  it("never writes inventario.stock directly", () => {
    // El catálogo no puede mover stock físico: eso es exclusivo de la venta.
    const descuentoCrudo = /UPDATE\s+inventario\s+SET\s+stock\s*=/i
    expect(cuerpo, `definición vigente en ${archivo}`).not.toMatch(descuentoCrudo)
  })

  it("increments inventario.stock_reservado instead", () => {
    expect(cuerpo).toMatch(/stock_reservado\s*=\s*stock_reservado\s*\+/i)
  })

  it("validates availability net of existing reservations", () => {
    // No puede calcular disponible sin leer stock_reservado de inventario;
    // si solo lee `stock`, está validando contra stock crudo otra vez.
    expect(cuerpo).toMatch(/SELECT\s+stock,\s*stock_reservado[\s\S]{0,120}FROM\s+inventario/i)
    expect(cuerpo).toMatch(/Stock insuficiente/)
  })

  it("mirrors the reservation into the per-deposit detail", () => {
    expect(cuerpo).toMatch(/reservar_stock_deposito\s*\(/i)
  })

  it("leaves an audit row in movimientos_inventario", () => {
    expect(cuerpo).toMatch(/INSERT\s+INTO\s+movimientos_inventario/i)
    expect(cuerpo).toMatch(/'RESERVA'/)
  })

  it("keeps the catalog-only stock columns as the fallback source", () => {
    // Items sin link a inventario (y variantes) no tienen fila de inventario ni
    // detalle por depósito: siguen usando su contador propio del catálogo.
    expect(cuerpo).toMatch(/UPDATE\s+catalogo_items\s+SET\s+stock\s*=/i)
    expect(cuerpo).toMatch(/UPDATE\s+catalogo_variantes\s+SET\s+stock\s*=/i)
  })
})

describe("crear_cotizacion_publica_atomica — la reserva queda trazable", () => {
  const { archivo, cuerpo } = ultimaDefinicion("crear_cotizacion_publica_atomica")

  it("passes the cotizacion id down to reservar_stock_catalogo", () => {
    // Sin el id, el asiento en movimientos_inventario queda sin referencia y la
    // reserva no se puede rastrear hasta la solicitud que la originó.
    const llamada = cuerpo.match(/reservar_stock_catalogo\s*\(([^)]*)\)/i)
    expect(llamada, `definición vigente en ${archivo}`).not.toBeNull()
    expect(llamada![1]).toMatch(/v_cotizacion_id/)
  })

  it("still creates the cotizacion as PRESUPUESTO/ENVIADA from CATALOGO_PUBLICO", () => {
    expect(cuerpo).toMatch(/'PRESUPUESTO'/)
    expect(cuerpo).toMatch(/'ENVIADA'/)
    expect(cuerpo).toMatch(/'CATALOGO_PUBLICO'/)
  })
})
