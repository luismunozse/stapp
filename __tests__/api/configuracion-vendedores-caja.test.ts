// @vitest-environment node
/**
 * Toggle `vendedores_manejan_caja` en /api/configuracion.
 *
 * Gemelo del de `tecnicos_operan_pos` (314) y del de
 * `vendedores_administran_inventario` (275): preferencia de la organización,
 * opt-in, default apagado, y solo el ADMIN lo mueve — GET/PUT de esta ruta van
 * por requireAdmin().
 *
 * Incluye la degradación con la migración sin aplicar: en este proyecto las
 * migraciones se corren A MANO y después del merge, así que siempre hay una
 * ventana con el deploy adelante de su columna. Ahí guardar el resto de la
 * configuración NO puede fallar por este campo.
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
    ultimoSelect.includes("vendedores_manejan_caja")
      ? {
          data: null,
          error: {
            code: "42703",
            message: "column organizations.vendedores_manejan_caja does not exist",
          },
        }
      : { data: fila, error: null },
  ) as any
  return chain
}

describe("/api/configuracion — permiso de caja para vendedores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("GET devuelve el flag prendido", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgRow({ vendedores_manejan_caja: true })) })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.vendedoresManejanCaja).toBe(true)
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
    })
    const chain = chainSinColumna(orgCompleta)
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.vendedoresManejanCaja).toBe(false)

    // Exactamente dos intentos: el flag es su propio escalón y el segundo ya
    // acierta. Tres o más significa que arrastró a otra migración con él.
    expect(chain.single).toHaveBeenCalledTimes(2)

    // Y nada de lo que sí existe se perdió en el camino.
    expect(body.tecnicosOperanPos).toBe(true)
    expect(body.ivaRegimen).toBe("ADITIVO")
    expect(body.cotizacionTerminos).toBe("30 días")
    expect(body.recepcionTerminos).toBe("términos de recepción")
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.ingresosBrutos).toBe("902-123456-7")
    expect(body.facturacionElectronicaHabilitada).toBe(true)
  })

  it("PUT lo persiste", async () => {
    const chain = createChainMock(orgRow({ vendedores_manejan_caja: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(putRequest({ vendedoresManejanCaja: true }))) as Response,
    )

    expect(status).toBe(200)
    expect(body.vendedoresManejanCaja).toBe(true)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ vendedores_manejan_caja: true }),
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
        vendedoresManejanCaja: true,
        ivaRegimen: "ADITIVO",
        vendedoresAdministranInventario: true,
        tecnicosOperanPos: true,
      }),
    )

    expect(res.status).toBe(200)

    // El único campo que se cae es el que no tiene columna.
    const escrito = chain.update.mock.calls.at(-1)![0]
    expect(escrito).not.toHaveProperty("vendedores_manejan_caja")
    expect(escrito.iva_regimen).toBe("ADITIVO")
    expect(escrito.vendedores_administran_inventario).toBe(true)
    expect(escrito.tecnicos_operan_pos).toBe(true)
  })

  it("PUT lo apaga cuando llega en false: es un toggle, no un set-once", async () => {
    const chain = createChainMock(orgRow({ vendedores_manejan_caja: false }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    await PUT(putRequest({ vendedoresManejanCaja: false }))

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ vendedores_manejan_caja: false }),
    )
  })

  it("PUT sin cambios devuelve el flag actual, no un false fabricado", async () => {
    // La rama de "no hay nada que actualizar" tiene su PROPIA cascada de
    // SELECT. Si el flag no viaja en ella, la pantalla de configuración
    // muestra el toggle apagado aunque en la DB esté prendido, y el siguiente
    // guardado lo apaga de verdad.
    const chain = createChainMock(orgRow({ vendedores_manejan_caja: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.vendedoresManejanCaja).toBe(true)
    expect(chain.update).not.toHaveBeenCalled()
  })
})
