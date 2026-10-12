// @vitest-environment node
/**
 * Importar inventario ES escribir inventario, y /api/import es la única puerta
 * por la que se podía hacer sin pasar por `requireInventarioAccess`.
 *
 * El handler atiende dos entidades con el mismo código (`entityType` acepta
 * exactamente "CLIENTES" e "INVENTARIO") y estaba gateado solo con
 * `requireAuth()` más el feature de plan: ningún chequeo de rol. Un VENDEDOR de
 * una organización con `vendedores_administran_inventario = false` podía crear
 * items en masa desde el dropdown "Importar" de la lista.
 *
 * Hasta ahora eso era inalcanzable por accidente —el gate de la página lo
 * sacaba de /inventario ante cualquier fallo del chequeo—, y ese accidente dejó
 * de existir cuando la página pasó a sostenerse ante un error de red. Se cierra
 * donde corresponde: en el servidor.
 *
 * CLIENTES no se toca. Es la otra mitad del mismo handler y su permiso es una
 * pregunta distinta, fuera de alcance acá.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
  checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

import { hasPlanFeature } from "@/lib/subscriptions"

/** La org contesta el flag opt-in que habilita al VENDEDOR. */
function orgConFlag(habilitado: boolean) {
  mockSupabaseFrom({
    organizations: createChainMock({ vendedores_administran_inventario: habilitado }),
  })
}

/**
 * Cuerpo con un formato de archivo deliberadamente no soportado: alcanza para
 * llegar hasta el gate y hace que lo que se mida sea el 403, no el parseo. Todo
 * lo que pasa el permiso muere después en un 400 de formato.
 */
function cuerpo(entityType: "INVENTARIO" | "CLIENTES") {
  return { file: "eyJhIjoxfQ==", mime: "text/plain", filename: "datos.txt", entityType }
}

async function postExecute(entityType: "INVENTARIO" | "CLIENTES") {
  const { POST } = await import("@/app/api/import/execute/route")
  return parseResponse(await POST(createPostRequest(cuerpo(entityType))))
}

async function postPreview(entityType: "INVENTARIO" | "CLIENTES") {
  const { POST } = await import("@/app/api/import/preview/route")
  return parseResponse(await POST(createPostRequest(cuerpo(entityType))))
}

describe("POST /api/import/execute — permiso de inventario", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rechaza a un VENDEDOR cuya organización no le habilitó el inventario", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)

    const { status, body } = await postExecute("INVENTARIO")

    expect(status).toBe(403)
    expect(body.error).toBe("Acceso denegado")
  })

  it("deja pasar al VENDEDOR que sí lo tiene habilitado", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(true)

    // 400 de formato = el permiso ya quedó atrás.
    const { status } = await postExecute("INVENTARIO")

    expect(status).toBe(400)
  })

  it("deja pasar al ADMIN sin consultar el flag", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    orgConFlag(false)

    const { status } = await postExecute("INVENTARIO")

    expect(status).toBe(400)
  })

  it("rechaza a un TECNICO, que nunca administra inventario", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    orgConFlag(true)

    const { status } = await postExecute("INVENTARIO")

    expect(status).toBe(403)
  })

  it("no rompe la importación de CLIENTES, que es otro permiso", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)

    const { status } = await postExecute("CLIENTES")

    expect(status).toBe(400)
  })
})

describe("POST /api/import/preview — permiso de inventario", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rechaza a un VENDEDOR sin el permiso, en el primer paso del flujo", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)

    const { status, body } = await postPreview("INVENTARIO")

    expect(status).toBe(403)
    expect(body.error).toBe("Acceso denegado")
  })

  it("deja pasar al VENDEDOR habilitado", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(true)

    const { status } = await postPreview("INVENTARIO")

    expect(status).toBe(400)
  })

  it("no rompe el preview de CLIENTES", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)

    const { status } = await postPreview("CLIENTES")

    expect(status).toBe(400)
  })
})

/**
 * El chequeo de plan corría ANTES del de rol, así que a un vendedor que nunca
 * va a poder importar inventario se le contestaba "necesitás el plan
 * Profesional". Un admin persiguiendo ese mensaje puede pagar un upgrade que no
 * cambia nada.
 *
 * El gate de entidad va primero. No puede ir más arriba todavía —el
 * discriminador (`entityType`) viaja en el body, así que hay que leerlo— pero sí
 * antes de la consulta de plan y de todo el parseo del archivo.
 */
describe("orden de los gates en /api/import", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks limpia las llamadas, no las implementaciones: hay que
    // reponer el default o el `false` de un test se filtra a los que siguen.
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
  })

  it("le dice al vendedor que no tiene permiso, no que le falta plan", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const { status, body } = await postExecute("INVENTARIO")

    expect(status).toBe(403)
    expect(body.error).toBe("Acceso denegado")
    expect(body.code).toBeUndefined()
  })

  it("no gasta la consulta de plan por alguien que no puede escribir", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)

    await postExecute("INVENTARIO")

    expect(hasPlanFeature).not.toHaveBeenCalled()
  })

  it("sigue pidiendo el plan a quien sí tiene el permiso", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    orgConFlag(false)
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const { status, body } = await postExecute("INVENTARIO")

    expect(status).toBe(403)
    expect(body.code).toBe("PREMIUM_REQUIRED")
  })

  it("no cambia nada para CLIENTES, que no pasa por el gate de entidad", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const { status, body } = await postExecute("CLIENTES")

    expect(status).toBe(403)
    expect(body.code).toBe("PREMIUM_REQUIRED")
  })

  it("mismo orden en el preview", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    orgConFlag(false)
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const { status, body } = await postPreview("INVENTARIO")

    expect(status).toBe(403)
    expect(body.error).toBe("Acceso denegado")
  })
})
