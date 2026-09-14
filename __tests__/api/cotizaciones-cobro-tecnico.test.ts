// @vitest-environment node
/**
 * Permiso `tecnicos_cobran_cotizaciones` (migración 322) sobre
 * POST /api/cotizaciones/[id]/convertir-venta.
 *
 * Gemelo del de `tecnicos_operan_pos` (314): preferencia de la organización,
 * opt-in, default apagado, y una SUMA sobre el rol TECNICO — no un canje a
 * VENDEDOR. El técnico ya cotizaba (crear, enviar, aprobar y duplicar sus
 * cotizaciones fue siempre suyo, con alcance por `created_by`); lo que no podía
 * era cerrar el cobro, que era `role !== "ADMIN"` duro.
 *
 * Dos cosas que este archivo fija y que son fáciles de romper por separado:
 *
 *  1. El ALCANCE. El permiso lo habilita a cerrar SU trabajo. Sin el chequeo de
 *     `created_by`, prender el toggle le abriría de paso el cobro de las
 *     cotizaciones de todos los demás técnicos.
 *
 *  2. El FAIL-CLOSED con la migración sin aplicar. Acá las migraciones se corren
 *     A MANO y después del merge, así que siempre hay una ventana con el deploy
 *     adelante de su columna. En esa ventana el técnico tiene que recibir el
 *     mismo 403 que recibía antes, nunca un pase libre.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

// La resolución de sucursal corre ANTES de leer la cotización y depende de
// cookies y de la tabla `sucursales`. Sin mockearla devuelve null y el handler
// contesta 500 antes de llegar a los guards que este archivo ejercita.
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
}))

/**
 * Deja la conversión en sí resuelta, para que un test que espera pasar el guard
 * termine en el 201 real. Sin esto el handler muere en el RPC sin mockear y un
 * `not.toBe(403)` pasaría por explosión, no por permiso.
 */
function mockConversionOk() {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "venta-1" }, error: null } as any)
}

function convertRequest() {
  return new Request("http://localhost:3000/api/cotizaciones/cot-1/convertir-venta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metodoPago: "EFECTIVO",
      items: [{ cotizacionItemId: "item-1", diasGarantia: 0 }],
    }),
  })
}

const params = { params: Promise.resolve({ id: "cot-1" }) }

/**
 * La cotización que se intenta cobrar. Por default la creó `tecnico-1` y está
 * en un estado convertible; cada test mueve sólo lo que le importa.
 */
function cotizacionRow(overrides: Record<string, any> = {}) {
  return {
    id: "cot-1",
    organization_id: "org-1",
    estado: "ACEPTADA",
    tipo: "ORDEN",
    reemplazada_por: null,
    created_by: "tecnico-1",
    clientes: { id: "cli-1", nombre: "Cliente", telefono: null },
    ordenes_servicio: null,
    items_cotizacion: [
      { id: "item-1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 100, subtotal: 100, inventario_id: null },
    ],
    ...overrides,
  }
}

/** Flag de la org tal como lo lee resolveTecnicosCobranCotizaciones. */
function mockOrg(flag: boolean | undefined, error: any = null) {
  return createChainMock(
    flag === undefined ? null : { tecnicos_cobran_cotizaciones: flag },
    error
  )
}

describe("convertir-venta — permiso de cobro para técnicos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("el TECNICO sin el permiso sigue recibiendo 403", async () => {
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1", userId: "tecnico-1" })
    mockSupabaseFrom({
      organizations: mockOrg(false),
      cotizaciones: createChainMock(cotizacionRow()),
    })

    const { POST } = await import("@/app/api/cotizaciones/[id]/convertir-venta/route")
    const { status, body } = await parseResponse((await POST(convertRequest(), params)) as Response)

    expect(status).toBe(403)
    expect(body.error).toMatch(/administradores/i)
  })

  it("con la migración 322 sin aplicar el TECNICO recibe 403, no un pase libre", async () => {
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1", userId: "tecnico-1" })
    // 42703: la columna todavía no existe en este entorno.
    mockSupabaseFrom({
      organizations: mockOrg(undefined, { code: "42703", message: 'column "tecnicos_cobran_cotizaciones" does not exist' }),
      cotizaciones: createChainMock(cotizacionRow()),
    })

    const { POST } = await import("@/app/api/cotizaciones/[id]/convertir-venta/route")
    const { status } = await parseResponse((await POST(convertRequest(), params)) as Response)

    expect(status).toBe(403)
  })

  it("el TECNICO con el permiso pasa el guard sobre una cotización SUYA", async () => {
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1", userId: "tecnico-1" })
    mockSupabaseFrom({
      organizations: mockOrg(true),
      cotizaciones: createChainMock(cotizacionRow({ created_by: "tecnico-1" })),
      ventas: createChainMock({ numero_venta: 42 }),
    })
    mockConversionOk()

    const { POST } = await import("@/app/api/cotizaciones/[id]/convertir-venta/route")
    const { status, body } = await parseResponse((await POST(convertRequest(), params)) as Response)

    expect(status).toBe(201)
    expect(body.ventaId).toBe("venta-1")
  })

  it("el TECNICO con el permiso NO puede cobrar la cotización de otro técnico", async () => {
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1", userId: "tecnico-1" })
    mockSupabaseFrom({
      organizations: mockOrg(true),
      cotizaciones: createChainMock(cotizacionRow({ created_by: "tecnico-2" })),
    })

    const { POST } = await import("@/app/api/cotizaciones/[id]/convertir-venta/route")
    const { status, body } = await parseResponse((await POST(convertRequest(), params)) as Response)

    expect(status).toBe(403)
    expect(body.error).toBe("No autorizado")
  })

  it("el VENDEDOR queda afuera aunque el permiso esté prendido: es del TECNICO", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "vend-1" })
    mockSupabaseFrom({
      organizations: mockOrg(true),
      cotizaciones: createChainMock(cotizacionRow()),
    })

    const { POST } = await import("@/app/api/cotizaciones/[id]/convertir-venta/route")
    const { status } = await parseResponse((await POST(convertRequest(), params)) as Response)

    expect(status).toBe(403)
  })

  it("el ADMIN no paga el round-trip del flag: no depende de él", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "admin-1" })
    const orgChain = mockOrg(false)
    mockSupabaseFrom({
      organizations: orgChain,
      // Creada por otro: al ADMIN el chequeo de pertenencia no lo toca.
      cotizaciones: createChainMock(cotizacionRow({ created_by: "tecnico-2" })),
      ventas: createChainMock({ numero_venta: 43 }),
    })
    mockConversionOk()

    const { POST } = await import("@/app/api/cotizaciones/[id]/convertir-venta/route")
    const { status } = await parseResponse((await POST(convertRequest(), params)) as Response)

    expect(status).toBe(201)
    // El flag está en false y el ADMIN pasa igual: nunca se lo preguntó.
    expect(orgChain.select).not.toHaveBeenCalledWith("tecnicos_cobran_cotizaciones")
  })
})
