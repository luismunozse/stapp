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

describe("reservar_stock_catalogo — no crea reservas imposibles de liberar", () => {
  const { cuerpo } = ultimaDefinicion("reservar_stock_catalogo")

  it("requires the cotizacion id — no silently unreleasable reservations", () => {
    // Con `p_cotizacion_id TEXT DEFAULT NULL`, una llamada vieja de 2 args
    // seguia resolviendo y asentaba el movimiento con referencia_id NULL, que
    // ningun camino de liberacion puede encontrar. Sin default, falla fuerte.
    const { archivo } = ultimaDefinicion("reservar_stock_catalogo")
    const sql = readFileSync(join(MIGRATIONS_DIR, archivo), "utf8")
    const firma = sql.slice(
      sql.lastIndexOf("CREATE OR REPLACE FUNCTION reservar_stock_catalogo"),
      sql.lastIndexOf("CREATE OR REPLACE FUNCTION reservar_stock_catalogo") + 260
    )
    expect(firma).toMatch(/p_cotizacion_id\s+TEXT/i)
    expect(firma).not.toMatch(/p_cotizacion_id\s+TEXT\s+DEFAULT/i)
  })

  it("skips soft-deleted inventory rows", () => {
    // La liberación filtra `deleted_at IS NULL` y hace CONTINUE si no encuentra
    // (206:1450). Si la reserva no filtra igual, una fila muerta se puede
    // reservar y despues NINGUN camino la libera.
    const lecturaInventario = cuerpo.match(/FROM\s+inventario[\s\S]{0,120}?FOR UPDATE/i)
    expect(lecturaInventario).not.toBeNull()
    expect(lecturaInventario![0]).toMatch(/deleted_at\s+IS\s+NULL/i)
  })
})

describe("liberar_reserva_catalogo — devuelve lo que el catálogo tomó", () => {
  const { cuerpo } = ultimaDefinicion("liberar_reserva_catalogo")

  it("computes what to release from the movement ledger, not from the item rows", () => {
    // liberar_items_cotizacion libera LEAST(cantidad, stock_reservado) mirando
    // la fila de inventario, asi que sobre una cotizacion que nunca reservo se
    // comeria la reserva de OTRA. El libro mayor de movimientos referenciados a
    // esta cotizacion es lo unico que dice cuanto tomo esta cotizacion.
    expect(cuerpo).toMatch(/reserva_cotizacion_pendiente|movimientos_inventario/i)
  })

  it("writes the LIBERACION_RESERVA counter-entry so it is idempotent", () => {
    // Sin el asiento inverso, el neto del libro no baja y una segunda llamada
    // volveria a liberar.
    expect(cuerpo).toMatch(/'LIBERACION_RESERVA'/)
  })

  it("gives the reservation back on the aggregate and on the per-deposit detail", () => {
    expect(cuerpo).toMatch(/stock_reservado\s*-/i)
    expect(cuerpo).toMatch(/liberar_reserva_deposito\s*\(/i)
  })

  it("is scoped to catalog-born quotes", () => {
    expect(cuerpo).toMatch(/'CATALOGO_PUBLICO'/)
  })

  it("runs as SECURITY DEFINER with a pinned search_path", () => {
    // La dispara un trigger, asi que corre con el rol de quien haga el UPDATE.
    // Sin DEFINER, un UPDATE que no sea service_role hace que el cierre de las
    // reservas afecte 0 filas SIN error y el stock no vuelva.
    const { archivo } = ultimaDefinicion("liberar_reserva_catalogo")
    const sql = readFileSync(join(MIGRATIONS_DIR, archivo), "utf8")
    expect(sql).toMatch(/SECURITY DEFINER\s+SET\s+search_path\s*=/i)
  })

  it("locks the cotizacion row so two releases cannot race", () => {
    // El pendiente se calcula ANTES del lock sobre inventario. Si el cron de
    // expiracion y un rechazo pegan a la vez, los dos leen el mismo pendiente,
    // serializan en el lock de inventario y cada uno descuenta: stock_reservado
    // se clampea comiendose reserva ajena y el libro se va a negativo.
    const cabecera = cuerpo.slice(0, cuerpo.indexOf("FOR v_row"))
    expect(cabecera).toMatch(/FROM\s+cotizaciones[\s\S]{0,120}?FOR\s+UPDATE/i)
  })

  it("records the amount actually released, not the amount it wanted to release", () => {
    // El UPDATE clampea con GREATEST(0, ...) pero el asiento registraba la
    // cantidad entera: el libro netea a 0 mientras la columna libero menos, y
    // la diferencia queda irrecuperable y muda.
    expect(cuerpo).toMatch(/v_delta/)
    expect(cuerpo).toMatch(/'LIBERACION_RESERVA',\s*v_delta/)
  })

  it("restores the catalog-only stock columns too", () => {
    // Variantes e items sueltos no tienen fila de inventario, asi que su
    // descuento no vive en movimientos_inventario. Sin esto, un catalogo con
    // variantes sigue teniendo el drenaje anonimo irreversible.
    expect(cuerpo).toMatch(/UPDATE\s+catalogo_variantes\s+SET\s+stock\s*=\s*stock\s*\+/i)
    expect(cuerpo).toMatch(/UPDATE\s+catalogo_items\s+SET\s+stock\s*=\s*stock\s*\+/i)
  })

  it("restores the amount that was reserved, not the amount currently requested", () => {
    // Sumar ic.cantidad devolvia lo que la linea pide HOY: pedir 2, que el
    // admin edite a 10 y rechazar acreditaba 10 (+8 fantasma); borrar la linea
    // no devolvia nada. Lo que se devuelve sale del registro de la reserva.
    expect(cuerpo).toMatch(/catalogo_reservas_cotizacion/)
    expect(cuerpo).not.toMatch(/SUM\s*\(\s*ic\.cantidad\s*\)/i)
  })

  it("does not give back the reservation of a superseded quote", () => {
    // Interaccion con la migracion 312: al aprobar una revision, esa libera la
    // reserva de la reemplazada con liberar_items_cotizacion — que solo toca
    // inventario. Las clases B y C quedan tomadas por la original, pero el
    // compromiso ahora vive en la revision. Restituirlas al rechazar la
    // original devolveria stock que la revision todavia espera entregar.
    expect(cuerpo).toMatch(/reemplazada_por/)
  })

  it("closes each reservation row instead of relying on a quote-level flag", () => {
    // Un booleano por cotizacion no puede responder "cuanto" ni "de que linea".
    expect(cuerpo).toMatch(/liberada_at\s*=\s*NOW\(\)/i)
    expect(cuerpo).not.toMatch(/catalogo_stock_restaurado_at/)
  })
})

describe("consumir_reserva_catalogo — la venta se queda el stock", () => {
  const { cuerpo } = ultimaDefinicion("consumir_reserva_catalogo")

  it("closes the reservation WITHOUT giving stock back", () => {
    // En variantes/items sueltos el descuento del pedido ES el de la venta:
    // crear_venta_atomica no las toca. Si la venta no cierra la reserva, un
    // rechazo posterior acredita mercaderia que ya salio por la puerta.
    expect(cuerpo).toMatch(/liberada_at\s*=\s*NOW\(\)/i)
    expect(cuerpo).not.toMatch(/stock\s*=\s*stock\s*\+/i)
  })

  it("also closes the rows still attached to the quote this one revises", () => {
    // Si la que se vende es una revision, las filas quedaron en la original
    // (la 312 no las mueve). Sin este salto quedan abiertas para siempre.
    expect(cuerpo).toMatch(/revision_de/)
  })
})

describe("convertir_cotizacion_venta_atomica — consume la reserva del catálogo", () => {
  const { cuerpo } = ultimaDefinicion("convertir_cotizacion_venta_atomica")

  it("marks the catalog reservation consumed as part of the sale", () => {
    expect(cuerpo).toMatch(/consumir_reserva_catalogo\s*\(/i)
  })
})

describe("trigger de liberación — ninguna superficie se puede olvidar", () => {
  const { archivo } = ultimaDefinicion("liberar_reserva_catalogo")
  const sql = readFileSync(join(MIGRATIONS_DIR, archivo), "utf8")

  it("fires on the transition into a terminal state", () => {
    // Hay cuatro rutas que matan una cotizacion y una (reject-budget) se nos
    // paso: hace un UPDATE masivo por orden_id. Con el trigger, cualquier
    // camino — incluido SQL a mano — libera.
    expect(sql).toMatch(/CREATE\s+TRIGGER/i)
    expect(sql).toMatch(/AFTER\s+UPDATE\s+ON\s+cotizaciones/i)
    expect(sql).toMatch(/'RECHAZADA'/)
    expect(sql).toMatch(/deleted_at/)
  })

  it("guards the WHEN clause so the release cannot re-fire itself", () => {
    expect(sql).toMatch(/WHEN\s*\(/i)
  })
})

describe("reservar_items_cotizacion — no reserva dos veces la misma cotización", () => {
  const { cuerpo } = ultimaDefinicion("reservar_items_cotizacion")

  it("skips items this quote already holds a reservation for", () => {
    // Camino real del doble descuento: catalogo reserva -> convertir-orden pone
    // tipo=ORDEN -> aprobar reserva OTRA VEZ porque tipo <> 'PRESUPUESTO'.
    // Quedaba 2x reservado y la venta solo liberaba 1x.
    expect(cuerpo).toMatch(/reserva_cotizacion_pendiente/i)
  })

  it("walks the ledger too, not only the lines that still exist", () => {
    // Si el admin BORRA la linea de un producto, un loop sobre
    // items_cotizacion no vuelve a visitarlo nunca — ni aca ni en
    // liberar_items_cotizacion, que tambien itera lineas. La reserva quedaba
    // tomada para siempre. Del lado del libro entra con cantidad 0 y cae en la
    // rama de exceso.
    expect(cuerpo).toMatch(/FULL\s+OUTER\s+JOIN\s+reserva_cotizacion_pendiente/i)
    expect(cuerpo).toMatch(/COALESCE\(\s*li\.cantidad\s*,\s*0\s*\)/i)
  })

  it("aggregates the required quantity per product, like the ledger does", () => {
    // reserva_cotizacion_pendiente agrupa por inventario_id. Comparar ese
    // agregado contra la cantidad de UNA linea sub-reserva las cotizaciones con
    // el mismo producto repetido (dos lineas de 3 reservaban 3, no 6), y
    // cotizacion-form.tsx agrega lineas sin deduplicar por inventarioId.
    const loop = cuerpo.match(/FOR\s+v_item\s+IN[\s\S]*?LOOP/i)
    expect(loop).not.toBeNull()
    expect(loop![0]).toMatch(/GROUP\s+BY\s+ic\.inventario_id/i)
    expect(loop![0]).toMatch(/SUM\s*\(\s*ic\.cantidad\s*\)/i)
  })

  it("releases the excess when the quote shrank below what it holds", () => {
    // El guard `faltante <= 0 → CONTINUE` cubria la sobre-reserva pero nunca la
    // sobre-cobertura: catalogo reserva 5, el admin edita a 2, la aprobacion
    // saltea, la venta libera LEAST(2,...) y quedan 3 tomadas para siempre —
    // inalcanzables, porque el DELETE rechaza cotizaciones ACEPTADA.
    expect(cuerpo).toMatch(/v_faltante\s*<\s*0/)
    expect(cuerpo).toMatch(/'LIBERACION_RESERVA'/)
  })

  it("reserves only the shortfall, never the full amount on top", () => {
    // Con cobertura parcial (la solicitud reservo 2, un admin edito la linea a
    // 5) el guard todo-o-nada reservaba 5 encima de 2: 7 reservado para una
    // cotizacion de 5, y la venta liberaba 5 dejando 2 colgadas para siempre.
    expect(cuerpo).toMatch(/v_faltante\s*:=\s*v_item\.cantidad\s*-\s*COALESCE\(\s*v_ya_reservado/i)
    // Lo que se reserva es el faltante, no la cantidad entera.
    expect(cuerpo).toMatch(/stock_reservado\s*=\s*stock_reservado\s*\+\s*v_faltante/i)
    expect(cuerpo).not.toMatch(/stock_reservado\s*=\s*stock_reservado\s*\+\s*v_item\.cantidad/i)
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
