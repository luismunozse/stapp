// @vitest-environment node
/**
 * Toggle `tecnicos_toman_ordenes` (migration 374) in /api/configuracion.
 *
 * Twin of `tecnicos_operan_pos` (314) and `tecnicos_cobran_cotizaciones` (322):
 * per-org preference, opt-in, default off, only ADMIN moves it (GET/PUT of this
 * route go through requireAdmin()).
 *
 * Includes the degradation with the migration NOT applied: migrations are run
 * BY HAND after the merge, so there is always a window with the deploy ahead of
 * its column. Saving the rest of the settings must not fail because of this field.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

function orgRow(overrides: Record<string, any> = {}) {
  return {
    id: "org-1",
    nombre_mostrar: "Test Org",
    nombre: "Test Org",
    moneda: "ARS",
    zona_horaria: "America/Argentina/Buenos_Aires",
    pais: "AR",
    modulo_agenda: false,
    vendedores_administran_inventario: false,
    ...overrides,
  }
}

function putRequest(body: Record<string, any>) {
  return new Request("http://localhost:3000/api/configuracion", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * Chain que mira el SELECT que se mandó, no el número de intento: cualquier
 * consulta que nombre la columna ausente falla, como fallaría de verdad.
 * Contar intentos y devolver datos completos igual es un falso verde — daría
 * por bueno un escalón que en producción vuelve a fallar.
 */
function chainSinColumna(fila: Record<string, any>) {
  const chain = createChainMock(fila)
  let ultimoSelect = ""
  chain.select = vi.fn((cols: string) => {
    ultimoSelect = cols
    return chain
  }) as any
  chain.single = vi.fn(async () =>
    ultimoSelect.includes("tecnicos_toman_ordenes")
      ? {
          data: null,
          error: {
            code: "42703",
            message: "column organizations.tecnicos_toman_ordenes does not exist",
          },
        }
      : { data: fila, error: null },
  ) as any
  return chain
}

describe("/api/configuracion — permiso para que los técnicos tomen órdenes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("GET devuelve el flag prendido", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgRow({ tecnicos_toman_ordenes: true })) })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosTomanOrdenes).toBe(true)
  })

  it("GET con la migración sin aplicar degrada SOLO el flag: no se lleva puesta la config", async () => {
    // El GET baja por escalones de SELECT, uno por migración. Si esta columna
    // viajara en un escalón que ya existía, su 42703 tumbaría ese escalón
    // entero y la cascada seguiría cayendo hasta el fallback mínimo: el admin
    // recibiría la configuración MUTILADA —sin terminología, sin régimen de
    // IVA, sin datos fiscales— y el primer "Guardar Cambios" escribiría esos
    // vacíos encima de lo que había. Misma forma que el incidente de #283
    // contra la 294.
    const orgCompleta = orgRow({
      cotizacion_terminos: "30 días",
      recepcion_terminos: "términos de recepción",
      iva_regimen: "ADITIVO",
      iva_tasa: 21,
      terminologia: {},
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
      ingresos_brutos: "902-123456-7",
      facturacion_electronica_habilitada: true,
      tecnicos_operan_pos: true,
      vendedores_manejan_caja: true,
    })
    const chain = chainSinColumna(orgCompleta)
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosTomanOrdenes).toBe(false)

    // Two attempts: this flag has its own step on top of everything, and the
    // second (without it) already succeeds. More than two means it dragged
    // another migration down with it. Assert WHICH select each attempt carried,
    // not only how many there were.
    expect(chain.single).toHaveBeenCalledTimes(2)
    const selects = chain.select.mock.calls.map((c: any[]) => c[0] as string)
    expect(selects[0]).toContain("tecnicos_toman_ordenes")
    expect(selects.filter((s) => s.includes("tecnicos_toman_ordenes"))).toHaveLength(1)
    expect(selects[1]).not.toContain("tecnicos_toman_ordenes")
    expect(selects[1]).toContain("orden_formato_papel")
    expect(selects[1]).toContain("pos_agrupa_variantes")

    // Y nada de lo que sí existe se perdió en el camino.
    expect(body.tecnicosOperanPos).toBe(true)
    expect(body.vendedoresManejanCaja).toBe(true)
    expect(body.ivaRegimen).toBe("ADITIVO")
    expect(body.cotizacionTerminos).toBe("30 días")
    expect(body.recepcionTerminos).toBe("términos de recepción")
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.ingresosBrutos).toBe("902-123456-7")
    expect(body.facturacionElectronicaHabilitada).toBe(true)
  })

  it("PUT lo persiste", async () => {
    const chain = createChainMock(orgRow({ tecnicos_toman_ordenes: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(putRequest({ tecnicosTomanOrdenes: true }))) as Response,
    )

    expect(status).toBe(200)
    expect(body.tecnicosTomanOrdenes).toBe(true)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_toman_ordenes: true }),
    )
  })

  it("PUT con la migración sin aplicar degrada SOLO el flag: no se lleva puesto el resto del guardado", async () => {
    // Gemelo del caso del GET, y más filoso: en el PUT los escalones se
    // construyen encima de `selectCols`, así que una columna metida ahí viaja
    // en TODOS. Sin la columna, la cascada caería hasta el último escalón, que
    // borra de updateData el régimen de IVA, la terminología y los otros dos
    // flags opt-in: el admin guarda y esos campos se pierden sin un solo
    // error en pantalla.
    const chain = chainSinColumna(orgRow({ iva_regimen: "ADITIVO" }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const res = await PUT(
      putRequest({
        tecnicosTomanOrdenes: true,
        ivaRegimen: "ADITIVO",
        vendedoresAdministranInventario: true,
        tecnicosOperanPos: true,
        vendedoresManejanCaja: true,
      }),
    )

    expect(res.status).toBe(200)

    // El único campo que se cae es el que no tiene columna.
    const escrito = chain.update.mock.calls.at(-1)![0]
    expect(escrito).not.toHaveProperty("tecnicos_toman_ordenes")
    expect(escrito.iva_regimen).toBe("ADITIVO")
    expect(escrito.vendedores_administran_inventario).toBe(true)
    expect(escrito.tecnicos_operan_pos).toBe(true)
    expect(escrito.vendedores_manejan_caja).toBe(true)
  })

  it("PUT lo apaga cuando llega en false: es un toggle, no un set-once", async () => {
    const chain = createChainMock(orgRow({ tecnicos_toman_ordenes: false }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    await PUT(putRequest({ tecnicosTomanOrdenes: false }))

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_toman_ordenes: false }),
    )
  })

  it("PUT sin cambios devuelve el flag actual, no un false fabricado", async () => {
    // La rama de "no hay nada que actualizar" tiene su PROPIA cascada de
    // SELECT. Si el flag no viaja en ella, la pantalla de configuración
    // muestra el toggle apagado aunque en la DB esté prendido, y el siguiente
    // guardado lo apaga de verdad.
    const chain = createChainMock(orgRow({ tecnicos_toman_ordenes: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosTomanOrdenes).toBe(true)
    expect(chain.update).not.toHaveBeenCalled()
  })
})
