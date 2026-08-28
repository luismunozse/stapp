// @vitest-environment node
/**
 * Toggle `tecnicos_operan_pos` (migración 314) en /api/configuracion.
 *
 * Gemelo del de `vendedores_administran_inventario` (275): preferencia de la
 * organización, opt-in, default apagado, y solo el ADMIN lo mueve — GET/PUT de
 * esta ruta van por requireAdmin().
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

describe("/api/configuracion — permiso de POS para técnicos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("GET devuelve el flag prendido", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgRow({ tecnicos_operan_pos: true })) })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosOperanPos).toBe(true)
  })

  it("GET con la 314 sin aplicar degrada SOLO el flag: no se lleva puesta la config", async () => {
    // El GET baja por escalones de SELECT, uno por migración. Si
    // tecnicos_operan_pos viaja en un escalón que ya existía, su 42703 tumba
    // ese escalón entero y la cascada sigue cayendo hasta el fallback mínimo:
    // el admin recibe la configuración MUTILADA —sin terminología, sin
    // régimen de IVA, sin datos fiscales— y el primer "Guardar Cambios"
    // escribe esos vacíos encima de lo que había. Misma forma que el
    // incidente de #283 contra la 294.
    //
    // La 314 tiene que ser su propio escalón, arriba de todo, igual que la
    // 296 y la 297.
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
    })
    // El mock mira el SELECT que se mandó, no el numero de intento: cualquier
    // consulta que nombre la columna ausente falla, como fallaria de verdad.
    // Contar intentos y devolver datos completos igual es un falso verde —
    // daria por bueno un escalon que en produccion vuelve a fallar.
    const chain = createChainMock()
    let ultimoSelect = ""
    chain.select = vi.fn((cols: string) => {
      ultimoSelect = cols
      return chain
    }) as any
    chain.single = vi.fn(async () =>
      ultimoSelect.includes("tecnicos_operan_pos")
        ? {
            data: null,
            error: { code: "42703", message: "column organizations.tecnicos_operan_pos does not exist" },
          }
        : { data: orgCompleta, error: null },
    ) as any
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosOperanPos).toBe(false)

    // Exactamente dos intentos: el flag es su propio escalón y el segundo ya
    // acierta. Tres o más significa que arrastró a otra migración con él.
    expect(chain.single).toHaveBeenCalledTimes(2)

    // Y nada de lo que sí existe se perdió en el camino.
    expect(body.ivaRegimen).toBe("ADITIVO")
    expect(body.cotizacionTerminos).toBe("30 días")
    expect(body.recepcionTerminos).toBe("términos de recepción")
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.condicionIva).toBe("Responsable Inscripto")
    expect(body.ingresosBrutos).toBe("902-123456-7")
    expect(body.facturacionElectronicaHabilitada).toBe(true)
  })

  it("PUT lo persiste", async () => {
    const chain = createChainMock(orgRow({ tecnicos_operan_pos: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(putRequest({ tecnicosOperanPos: true }))) as Response,
    )

    expect(status).toBe(200)
    expect(body.tecnicosOperanPos).toBe(true)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_operan_pos: true }),
    )
  })

  it("PUT con la 314 sin aplicar degrada SOLO el flag: no se lleva puesto el resto del guardado", async () => {
    // Gemelo del caso del GET, y mas filoso: en el PUT los escalones se
    // construyen encima de `selectCols`, asi que una columna metida ahi viaja
    // en TODOS. Con la 314 sin aplicar la cascada cae hasta el ultimo
    // escalon, que borra de updateData el regimen de IVA, la terminologia y
    // el flag de inventario del vendedor: el admin guarda y esos campos se
    // pierden sin un solo error en pantalla.
    const chain = createChainMock(orgRow({ iva_regimen: "ADITIVO" }))
    let ultimoSelect = ""
    chain.select = vi.fn((cols: string) => {
      ultimoSelect = cols
      return chain
    }) as any
    chain.single = vi.fn(async () =>
      ultimoSelect.includes("tecnicos_operan_pos")
        ? {
            data: null,
            error: { code: "42703", message: "column organizations.tecnicos_operan_pos does not exist" },
          }
        : { data: orgRow({ iva_regimen: "ADITIVO" }), error: null },
    ) as any
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const res = await PUT(
      putRequest({ tecnicosOperanPos: true, ivaRegimen: "ADITIVO", vendedoresAdministranInventario: true }),
    )

    expect(res.status).toBe(200)

    // El unico campo que se cae es el que no tiene columna.
    const escrito = chain.update.mock.calls.at(-1)![0]
    expect(escrito).not.toHaveProperty("tecnicos_operan_pos")
    expect(escrito.iva_regimen).toBe("ADITIVO")
    expect(escrito.vendedores_administran_inventario).toBe(true)
  })

  it("PUT lo apaga cuando llega en false: es un toggle, no un set-once", async () => {
    const chain = createChainMock(orgRow({ tecnicos_operan_pos: false }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    await PUT(putRequest({ tecnicosOperanPos: false }))

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_operan_pos: false }),
    )
  })
})
