// @vitest-environment node
/**
 * Toggle `tecnicos_ven_deuda_clientes` (migration 405) in /api/configuracion.
 *
 * Twin of `tecnicos_toman_ordenes` (374): per-org preference, opt-in, default
 * off, only ADMIN moves it (GET/PUT of this route go through requireAdmin()).
 * It decides whether a TECNICO can ask the assistant how much a client owes.
 *
 * Includes the degradation with the migration NOT applied: migrations are run
 * BY HAND after the merge, so there is always a window with the deploy ahead of
 * its column. Saving the rest of the settings must not fail because of this field.
 * This is the NEWEST top step of every cascade, so with only 405 missing the
 * cascade must stop one step down — everything else (374 included) still loads.
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
 * Chain que mira lo que se mandó, no el número de intento: cualquier SELECT que
 * nombre la columna ausente falla con 42703, y cualquier UPDATE cuyo payload la
 * nombre falla con PGRST204, como fallaría de verdad. Contar intentos y devolver
 * datos completos igual es un falso verde — daría por bueno un escalón que en
 * producción vuelve a fallar.
 */
function chainSinColumna(fila: Record<string, any>) {
  const chain = createChainMock(fila)
  let ultimoSelect = ""
  let ultimoPayload: Record<string, any> | undefined
  chain.select = vi.fn((cols: string) => {
    ultimoSelect = cols
    return chain
  }) as any
  chain.update = vi.fn((payload: Record<string, any>) => {
    ultimoPayload = { ...payload } // snapshot: la ruta borra claves de su propio objeto entre reintentos
    return chain
  }) as any
  chain.single = vi.fn(async () => {
    if (ultimoPayload && "tecnicos_ven_deuda_clientes" in ultimoPayload) {
      return {
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the 'tecnicos_ven_deuda_clientes' column of 'organizations' in the schema cache",
        },
      }
    }
    if (ultimoSelect.includes("tecnicos_ven_deuda_clientes")) {
      return {
        data: null,
        error: {
          code: "42703",
          message: "column organizations.tecnicos_ven_deuda_clientes does not exist",
        },
      }
    }
    return { data: fila, error: null }
  }) as any
  return chain
}

describe("/api/configuracion — permiso para que los técnicos vean la deuda de clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("GET devuelve el flag prendido", async () => {
    const chain = createChainMock(orgRow({ tecnicos_ven_deuda_clientes: true }))
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosVenDeudaClientes).toBe(true)
    expect(chain.single).toHaveBeenCalledTimes(1)
    expect(chain.select.mock.calls[0][0]).toContain("tecnicos_ven_deuda_clientes")
  })

  it("GET lo devuelve apagado por default (columna en NULL/ausente en la fila)", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgRow()) })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosVenDeudaClientes).toBe(false)
  })

  it("GET con la migración sin aplicar degrada SOLO el flag: no se lleva puesta la config", async () => {
    // El GET baja por escalones de SELECT, uno por migración. Si esta columna
    // viajara en un escalón que ya existía, su 42703 tumbaría ese escalón
    // entero y la cascada seguiría cayendo hasta el fallback mínimo: el admin
    // recibiría la configuración MUTILADA —sin terminología, sin régimen de
    // IVA, sin datos fiscales— y el primer "Guardar Cambios" escribiría esos
    // vacíos encima de lo que había.
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
      tecnicos_toman_ordenes: true,
    })
    const chain = chainSinColumna(orgCompleta)
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    // Fail-closed: sin columna, el técnico NO ve la deuda.
    expect(body.tecnicosVenDeudaClientes).toBe(false)

    // Two attempts: this flag is the newest step, on top of everything, and the
    // second (without it) already succeeds. More than two means it dragged
    // another migration down with it. Assert WHICH select each attempt carried,
    // not only how many there were.
    expect(chain.single).toHaveBeenCalledTimes(2)
    const selects = chain.select.mock.calls.map((c: any[]) => c[0] as string)
    expect(selects[0]).toContain("tecnicos_ven_deuda_clientes")
    expect(selects.filter((s) => s.includes("tecnicos_ven_deuda_clientes"))).toHaveLength(1)
    expect(selects[1]).not.toContain("tecnicos_ven_deuda_clientes")
    expect(selects[1]).toContain("tecnicos_toman_ordenes")
    expect(selects[1]).toContain("orden_formato_papel")
    expect(selects[1]).toContain("pos_agrupa_variantes")
    // Nothing else was dropped between the two attempts.
    expect(selects[0]).toBe(`${selects[1]}, tecnicos_ven_deuda_clientes`)

    // Y nada de lo que sí existe se perdió en el camino.
    expect(body.tecnicosTomanOrdenes).toBe(true)
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
    const chain = createChainMock(orgRow({ tecnicos_ven_deuda_clientes: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(putRequest({ tecnicosVenDeudaClientes: true }))) as Response,
    )

    expect(status).toBe(200)
    expect(body.tecnicosVenDeudaClientes).toBe(true)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_ven_deuda_clientes: true }),
    )
    expect(chain.single).toHaveBeenCalledTimes(1)
    expect(chain.select.mock.calls[0][0]).toContain("tecnicos_ven_deuda_clientes")
  })

  it("PUT con la migración sin aplicar degrada SOLO el flag: no se lleva puesto el resto del guardado", async () => {
    // Gemelo del caso del GET, y más filoso: en el PUT los escalones se
    // construyen encima de `selectCols`, así que una columna metida ahí viaja
    // en TODOS. Sin la columna, la cascada caería hasta el último escalón, que
    // borra de updateData el régimen de IVA, la terminología y los otros
    // flags opt-in: el admin guarda y esos campos se pierden sin un solo
    // error en pantalla.
    const chain = chainSinColumna(orgRow({ iva_regimen: "ADITIVO" }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const res = await PUT(
      putRequest({
        tecnicosVenDeudaClientes: true,
        tecnicosTomanOrdenes: true,
        ivaRegimen: "ADITIVO",
        vendedoresAdministranInventario: true,
        tecnicosOperanPos: true,
        vendedoresManejanCaja: true,
      }),
    )

    expect(res.status).toBe(200)

    // Exactly two attempts: the first names the column (payload and select),
    // the retry drops ONLY it.
    expect(chain.single).toHaveBeenCalledTimes(2)
    const primero = chain.update.mock.calls[0][0]
    expect(chain.update).toHaveBeenCalledTimes(2)
    const selects = chain.select.mock.calls.map((c: any[]) => c[0] as string)
    expect(selects[0]).toContain("tecnicos_ven_deuda_clientes")
    expect(selects[1]).not.toContain("tecnicos_ven_deuda_clientes")
    expect(selects[1]).toContain("tecnicos_toman_ordenes")

    // El único campo que se cae es el que no tiene columna.
    const escrito = chain.update.mock.calls.at(-1)![0]
    expect(primero).toBe(escrito) // same object, mutated in place by the route
    expect(escrito).not.toHaveProperty("tecnicos_ven_deuda_clientes")
    expect(escrito.tecnicos_toman_ordenes).toBe(true)
    expect(escrito.iva_regimen).toBe("ADITIVO")
    expect(escrito.vendedores_administran_inventario).toBe(true)
    expect(escrito.tecnicos_operan_pos).toBe(true)
    expect(escrito.vendedores_manejan_caja).toBe(true)
  })

  it("PUT lo apaga cuando llega en false: es un toggle, no un set-once", async () => {
    const chain = createChainMock(orgRow({ tecnicos_ven_deuda_clientes: false }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    await PUT(putRequest({ tecnicosVenDeudaClientes: false }))

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_ven_deuda_clientes: false }),
    )
  })

  it("PUT que no lo manda no lo toca", async () => {
    const chain = createChainMock(orgRow({ tecnicos_ven_deuda_clientes: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    await PUT(putRequest({ tecnicosTomanOrdenes: true }))

    expect(chain.update.mock.calls[0][0]).not.toHaveProperty("tecnicos_ven_deuda_clientes")
  })

  it("PUT sin cambios devuelve el flag actual, no un false fabricado", async () => {
    // La rama de "no hay nada que actualizar" tiene su PROPIA cascada de
    // SELECT. Si el flag no viaja en ella, la pantalla de configuración
    // muestra el toggle apagado aunque en la DB esté prendido, y el siguiente
    // guardado lo apaga de verdad.
    const chain = createChainMock(orgRow({ tecnicos_ven_deuda_clientes: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosVenDeudaClientes).toBe(true)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("PUT sin cambios con la migración sin aplicar: un reintento, sin el flag, nada escrito", async () => {
    const chain = chainSinColumna(orgRow({ iva_regimen: "ADITIVO", tecnicos_toman_ordenes: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosVenDeudaClientes).toBe(false)
    expect(body.tecnicosTomanOrdenes).toBe(true)
    expect(body.ivaRegimen).toBe("ADITIVO")
    expect(chain.update).not.toHaveBeenCalled()
    expect(chain.single).toHaveBeenCalledTimes(2)
    const selects = chain.select.mock.calls.map((c: any[]) => c[0] as string)
    expect(selects[0]).toBe(`${selects[1]}, tecnicos_ven_deuda_clientes`)
  })
})
