// @vitest-environment node
/**
 * Every sub-route of /api/ordenes/[id] answers within the caller's scope (change
 * sucursales-aislamiento, PR3; XC-1, XC-2, OI-1, OI-2).
 *
 * For each handler, a caller asking for an order that is out of his scope (another branch, another
 * organization, an assignment he holds only because his role changed) gets EXACTLY what a
 * nonexistent id gets (status and body), and the request leaves nothing behind: no insert, update,
 * delete, RPC, storage or auth call (so no stock move, no payment row, no installment), no client
 * notification (WhatsApp / email go through `queueNotification`), no webhook, no audit entry, no
 * stored or deleted photo. The practice-order guard is switched on for those calls and must never
 * run for an order out of scope.
 *
 * The tables are in-memory and honour their filters, so a handler that looks the order up wrongly
 * returns the wrong row. Each handler also gets a control call on an order of the caller's own
 * branch with an EXACT expected status (and body where there is one), so the table cannot go green
 * on requests that fail for another reason. A technician stays branch-level on these routes, as he
 * was before the scope check; the detail GET/PUT and the delivery keep their own narrowing.
 */
import { describe, it, expect, vi } from "vitest"
import { NextResponse } from "next/server"
import { mockAuthSuccess } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/storage", () => ({
  uploadOrderPhoto: vi.fn().mockResolvedValue({ url: "https://x/y.png", path: "org-1/y.png" }),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  base64ToBuffer: vi.fn(() => Buffer.from("img")),
}))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn(() => false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/subscriptions", () => ({ updateStorageUsage: vi.fn().mockResolvedValue({ error: null }) }))
vi.mock("@/lib/pdf", () => ({
  generateOrdenPDF: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  generateComprobanteEntregaPDF: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}))
vi.mock("@/lib/counters", () => ({ getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }) }))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))

import * as checklist from "@/app/api/ordenes/[id]/checklist/route"
import * as cobros from "@/app/api/ordenes/[id]/cobros/route"
import * as comprobanteEntrega from "@/app/api/ordenes/[id]/comprobante-entrega/route"
import * as cuotas from "@/app/api/ordenes/[id]/cuotas/route"
import * as entregar from "@/app/api/ordenes/[id]/entregar/route"
import * as eventos from "@/app/api/ordenes/[id]/eventos/route"
import * as fotos from "@/app/api/ordenes/[id]/fotos/route"
import * as foto from "@/app/api/ordenes/[id]/fotos/[fotoId]/route"
import * as notasCredito from "@/app/api/ordenes/[id]/notas-credito/route"
import * as pdf from "@/app/api/ordenes/[id]/pdf/route"
import * as reingreso from "@/app/api/ordenes/[id]/reingreso/route"
import * as repuestos from "@/app/api/ordenes/[id]/repuestos/route"
import * as servicios from "@/app/api/ordenes/[id]/servicios/route"
import * as tomar from "@/app/api/ordenes/[id]/tomar/route"
import { createAuditLogger } from "@/lib/audit"
import { queueNotification } from "@/lib/notifications/queue"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { uploadOrderPhoto, deleteFile } from "@/lib/storage"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { ORDEN_PRACTICA_ERROR } from "@/lib/onboarding/practica-shared"

const A = "suc-A"
const B = "suc-B"

const orden = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  numero_orden: 5,
  codigo_orden: "CEL-005",
  sucursal_id: A,
  tecnico_id: null,
  cliente_id: "c-1",
  estado: "RECIBIDO",
  dispositivo: "iPhone",
  tipo_dispositivo: "CELULAR",
  tipo_dispositivo_id: null,
  costo_final: 100,
  total_cobrado: 0,
  descuento_cobro: 0,
  estado_cobro: "PENDIENTE",
  fecha_ingreso: "2026-01-01T00:00:00Z",
  fecha_completado: null,
  public_token: "tok",
  clientes: { id: "c-1", nombre: "Juan", email: null, telefono: "1" },
  organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
  notas_credito: [],
  ...extra,
})

const ORDENES = [
  orden("o-a-libre"),
  orden("o-a-t2", { tecnico_id: "t-2" }),
  orden("o-a-reparada", { estado: "REPARADO" }),
  orden("o-a-entregada", { estado: "ENTREGADO", firma_cliente_entrega: "firma", fecha_entrega: "2026-01-02T00:00:00Z" }),
  orden("o-b-libre", { sucursal_id: B }),
  orden("o-b-t1", { sucursal_id: B, tecnico_id: "t-1" }),
  orden("o-b-t2", { sucursal_id: B, tecnico_id: "t-2" }),
  orden("o-b-reparada-t1", { sucursal_id: B, tecnico_id: "t-1", estado: "REPARADO" }),
  orden("o-otra-org", { organization_id: "org-2" }),
]

const FOTOS = [
  ["f-a", "o-a-libre"],
  ["f-b", "o-b-libre"],
  ["f-bt1", "o-b-t1"],
  ["f-otra", "o-otra-org"],
].map(([id, ordenId]) => ({
  id,
  orden_id: ordenId,
  storage_path: `${ordenId}/f.png`,
  url: "https://x/f.png",
  mime: "image/png",
  size: 3,
  descripcion: null,
  tipo: "INGRESO",
  created_at: "2026-01-01T00:00:00Z",
}))

/** What each RPC answers, in the shape its route reads. */
function resultadoRpc(nombre: string) {
  if (nombre === "registrar_cobros_orden_atomica") {
    return { replayed: false, response: { orden: { totalCobrado: 100, estadoCobro: "COBRADO", descuento: 0 }, cobros: [] } }
  }
  if (nombre === "agregar_servicio_orden") {
    return {
      id: "lin-1", servicio_id: null, nombre: "Mano de obra", cantidad: 1, precio_unitario: 100,
      campoSincronizado: "presupuesto", montoActualizado: true, costoFinalActualizado: false, sumaServicios: 100,
    }
  }
  if (nombre === "eliminar_servicio_orden") {
    return { campoSincronizado: "presupuesto", montoActualizado: true, costoFinalActualizado: false, sumaServicios: 0 }
  }
  if (nombre === "aplicar_monto_servicios_orden") return { campoSincronizado: "costo_final", monto: 100 }
  return { success: true }
}

interface Montaje {
  /** The practice-order guard answers 409 for every call (it must never run for an order out of scope). */
  practica?: boolean
  /** Makes every read of the orders table fail with a database error. */
  fallaLaBase?: boolean
  sucursalId?: string | null
}

function montar(role: string, userId: string, { practica = false, fallaLaBase = false, sucursalId = A }: Montaje = {}) {
  vi.clearAllMocks()
  mockAuthSuccess({ role, userId, sucursalId })
  vi.mocked(rejectIfPractica).mockImplementation(async () =>
    practica ? NextResponse.json(ORDEN_PRACTICA_ERROR, { status: 409 }) : null,
  )
  return montarSupabaseEnMemoria(
    {
      ordenes_servicio: ORDENES,
      fotos_orden: FOTOS,
      repuestos_orden: [
        { id: "r-1", orden_id: "o-a-libre", inventario_id: "inv-1", cantidad: 1 },
        { id: "r-b", orden_id: "o-b-libre", inventario_id: "inv-1", cantidad: 1 },
      ],
      checklist_templates: [
        { id: "tpl-1", organization_id: "org-1", nombre: "Basica", activo: true, tipo_dispositivo_id: null, orden: 1, checklist_template_items: [] },
      ],
      checklist_recepcion: [
        { id: "ck-1", orden_id: "o-a-t2", template_id: "tpl-1", valores: "{}", notas: null, firma_cliente: null, firma_mime: null },
      ],
      users: [{ id: "t-1", rol: "TECNICO", organization_id: "org-1", porcentaje_comision: 10, costo_hora: 100 }],
      organizations: [
        {
          id: "org-1",
          tecnicos_toman_ordenes: true,
          vendedores_manejan_caja: true,
          vendedores_administran_inventario: false,
          zona_horaria: "America/Argentina/Buenos_Aires",
          nombre: "Taller",
          nombre_mostrar: "Taller",
          slug: "taller",
          moneda: "ARS",
          telefono: null,
          direccion: null,
          ciudad: null,
          provincia: null,
          codigo_postal: null,
          logo_url: null,
        },
      ],
    },
    {
      resultadoRpc,
      ...(fallaLaBase ? { errorDeLectura: { ordenes_servicio: { code: "57014", message: "statement timeout" } } } : {}),
    },
  )
}

/** Nobody was told and nothing was stored. */
function nadieSeEntero() {
  expect(createAuditLogger).not.toHaveBeenCalled()
  expect(queueNotification).not.toHaveBeenCalled()
  expect(emitWebhookEvent).not.toHaveBeenCalled()
  expect(uploadOrderPhoto).not.toHaveBeenCalled()
  expect(deleteFile).not.toHaveBeenCalled()
}

async function respuestaDe(res: Response) {
  const tipo = res.headers.get("content-type") ?? ""
  return { status: res.status, tipo, body: tipo.includes("json") ? await res.json() : null }
}

const url = (id: string, resto = "") => `http://localhost:3000/api/ordenes/${id}${resto}`
const ctx = <T extends Record<string, string>>(id: string, extra: T = {} as T) => ({
  params: Promise.resolve({ id, ...extra }),
})
const sin = (metodo: string, id: string, resto = "") => new Request(url(id, resto), { method: metodo })
const con = (metodo: string, id: string, cuerpo: unknown, resto = "") =>
  new Request(url(id, resto), { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })

/** The photo of an order, for the handlers that are given a photo and not an order. */
const fotoDe = (idOrden: string) => FOTOS.find((f) => f.orden_id === idOrden)?.id ?? "f-no-existe"

const ORDEN_NO_ENCONTRADA = "Orden no encontrada"
const PDF = { status: 200, tipo: expect.stringContaining("application/pdf") }

interface Caso {
  nombre: string
  /** `id` is the order the caller asks for; the handlers that take a photo get the photo of that order. */
  llamar: (id: string) => Promise<Response>
  /** What the caller is told for a missing order (and so for one out of scope). */
  noEncontrada: string
  /** The route is closed to a TECNICO before it looks at any order (caja access, admin or seller). */
  sinTecnico?: boolean
  /** The route runs the practice-order guard once the order is in scope. */
  usaPractica?: boolean
  /** The call on an order of the caller's own branch: the order, and the exact answer. */
  control: { orden?: string; status: number; body?: unknown; tipo?: unknown }
}

const CASOS: Caso[] = [
  {
    nombre: "checklist GET",
    llamar: (id) => checklist.GET(sin("GET", id), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: { checklist: null, template: { id: "tpl-1", nombre: "Basica", items: [] } } },
  },
  {
    nombre: "checklist POST",
    llamar: (id) => checklist.POST(con("POST", id, { templateId: "tpl-1", valores: {} }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 201, body: expect.objectContaining({ ordenId: "o-a-libre", templateId: "tpl-1", valores: {} }) },
  },
  {
    nombre: "checklist PUT",
    llamar: (id) => checklist.PUT(con("PUT", id, { valores: { a: true } }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { orden: "o-a-t2", status: 200, body: expect.objectContaining({ ordenId: "o-a-t2", valores: { a: true } }) },
  },
  {
    nombre: "checklist DELETE",
    llamar: (id) => checklist.DELETE(sin("DELETE", id), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { orden: "o-a-t2", status: 200, body: { message: "Checklist eliminado" } },
  },
  {
    nombre: "cobros GET",
    llamar: (id) => cobros.GET(sin("GET", id), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: [] },
  },
  {
    nombre: "cobros POST",
    llamar: (id) => cobros.POST(con("POST", id, { pagos: [{ monto: 100, metodo: "EFECTIVO" }] }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    sinTecnico: true,
    usaPractica: true,
    control: { status: 201, body: { totalCobrado: 100, estadoCobro: "COBRADO", descuento: 0 } },
  },
  {
    nombre: "comprobante-entrega GET",
    llamar: (id) => comprobanteEntrega.GET(sin("GET", id), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { orden: "o-a-entregada", ...PDF },
  },
  {
    nombre: "cuotas GET",
    llamar: (id) => cuotas.GET(sin("GET", id), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: [] },
  },
  {
    nombre: "entregar POST",
    llamar: (id) => entregar.POST(con("POST", id, {}), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    usaPractica: true,
    control: { orden: "o-a-reparada", status: 200, body: expect.objectContaining({ id: "o-a-reparada", estado: "ENTREGADO" }) },
  },
  {
    nombre: "eventos GET",
    llamar: (id) => eventos.GET(sin("GET", id), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: [] },
  },
  {
    nombre: "fotos GET",
    llamar: (id) => fotos.GET(sin("GET", id, "/fotos"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: [expect.objectContaining({ id: "f-a" })] },
  },
  {
    nombre: "fotos POST",
    llamar: (id) => fotos.POST(con("POST", id, { data: "aGVsbG8=", mime: "image/png" }, "/fotos"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 201, body: expect.objectContaining({ url: "https://x/y.png" }) },
  },
  {
    // The order in the path is the caller's own; the photo is the one of the order he asks about.
    nombre: "fotos DELETE",
    llamar: (id) => fotos.DELETE(sin("DELETE", "o-a-libre", `/fotos?fotoId=${fotoDe(id)}`), ctx("o-a-libre")),
    noEncontrada: "Foto no encontrada",
    control: { status: 200, body: { message: "Foto eliminada" } },
  },
  {
    nombre: "fotos/[fotoId] GET",
    llamar: (id) => foto.GET(sin("GET", id, `/fotos/${fotoDe(id)}`), ctx(id, { fotoId: fotoDe(id) })),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: expect.objectContaining({ id: "f-a", ordenId: "o-a-libre" }) },
  },
  {
    nombre: "notas-credito GET",
    llamar: (id) => notasCredito.GET(sin("GET", id), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: [] },
  },
  {
    nombre: "pdf GET",
    llamar: (id) => pdf.GET(sin("GET", id, "/pdf"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: PDF,
  },
  {
    nombre: "reingreso POST",
    llamar: (id) => reingreso.POST(con("POST", id, { problemaReportado: "Volvió a fallar" }), ctx(id)),
    noEncontrada: "Orden original no encontrada",
    sinTecnico: true,
    usaPractica: true,
    control: { orden: "o-a-reparada", status: 201, body: expect.objectContaining({ numeroOrden: 1, codigoOrden: "CEL-001" }) },
  },
  {
    nombre: "repuestos POST",
    llamar: (id) =>
      repuestos.POST(con("POST", id, { tipo: "manual", nombre: "Pantalla", cantidad: 1, precioUnitario: 10 }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    usaPractica: true,
    control: { status: 201, body: { success: true } },
  },
  {
    nombre: "repuestos PATCH",
    llamar: (id) => repuestos.PATCH(con("PATCH", id, { cantidad: 2 }, "/repuestos?repuestoId=r-1"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: { success: true, cantidad: 2 } },
  },
  {
    nombre: "repuestos DELETE",
    llamar: (id) => repuestos.DELETE(sin("DELETE", id, "/repuestos?repuestoId=r-1"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: { success: true } },
  },
  {
    nombre: "servicios POST",
    llamar: (id) =>
      servicios.POST(con("POST", id, { tipo: "manual", nombre: "Mano de obra", cantidad: 1, precioUnitario: 100 }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    usaPractica: true,
    control: { status: 201, body: expect.objectContaining({ servicio: expect.objectContaining({ id: "lin-1", nombre: "Mano de obra" }) }) },
  },
  {
    nombre: "servicios DELETE",
    llamar: (id) => servicios.DELETE(sin("DELETE", id, "/servicios?servicioOrdenId=s-1"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    control: { status: 200, body: expect.objectContaining({ sumaServicios: 0 }) },
  },
  {
    nombre: "servicios PATCH",
    llamar: (id) => servicios.PATCH(sin("PATCH", id, "/servicios"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    usaPractica: true,
    control: { status: 200, body: { campoSincronizado: "costo_final", monto: 100 } },
  },
]

const caso = (nombre: string) => CASOS.find((c) => c.nombre === nombre)!

// Who asks for what, out of his scope. A TECNICO is left out of the routes that are closed to him.
const FUERA_DE_ALCANCE = [
  { quien: "a VENDEDOR of A, an order of B", rol: "VENDEDOR", userId: "v-a", sucursalId: A as string | null, id: "o-b-libre" },
  { quien: "a TECNICO of A, an order of B", rol: "TECNICO", userId: "t-1", sucursalId: A as string | null, id: "o-b-libre" },
  {
    quien: "a VENDEDOR of A who still holds the assignment of an order of B (his role changed)",
    rol: "VENDEDOR",
    userId: "t-1",
    sucursalId: A as string | null,
    id: "o-b-t1",
  },
  { quien: "a VENDEDOR of A, an order of another organization", rol: "VENDEDOR", userId: "v-a", sucursalId: A as string | null, id: "o-otra-org" },
  { quien: "an ADMIN, an order of another organization", rol: "ADMIN", userId: "adm", sucursalId: null as string | null, id: "o-otra-org" },
]

describe.each(CASOS)("$nombre", (c) => {
  const { llamar, noEncontrada } = c
  const escenarios = FUERA_DE_ALCANCE.filter((e) => !(c.sinTecnico && e.rol === "TECNICO"))

  it.each(escenarios)("$quien gets what a missing id gets, and leaves nothing behind", async ({ rol, userId, sucursalId, id }) => {
    const mem = montar(rol, userId, { practica: true, sucursalId })

    const inexistente = await respuestaDe(await llamar("no-existe"))
    const fuera = await respuestaDe(await llamar(id))

    expect(inexistente).toMatchObject({ status: 404, body: { error: noEncontrada } })
    expect(fuera).toEqual(inexistente)
    expect(mem.escrituras).toEqual([])
    // The practice-order guard also looks the order up by id: it must not answer before the scope does.
    expect(rejectIfPractica).not.toHaveBeenCalled()
    nadieSeEntero()
  })

  it("a VENDEDOR of the order's branch gets the real answer (control)", async () => {
    montar("VENDEDOR", "v-a")

    const propia = await respuestaDe(await llamar(c.control.orden ?? "o-a-libre"))

    expect(propia.status).toBe(c.control.status)
    if (c.control.body !== undefined) expect(propia.body).toEqual(c.control.body)
    if (c.control.tipo !== undefined) expect(propia.tipo).toEqual(c.control.tipo)
  })

  if (c.usaPractica) {
    it("once the order is in scope the practice-order guard still answers 409", async () => {
      const mem = montar("VENDEDOR", "v-a", { practica: true })

      const propia = await respuestaDe(await llamar(c.control.orden ?? "o-a-libre"))

      expect(propia).toMatchObject({ status: 409, body: ORDEN_PRACTICA_ERROR })
      expect(rejectIfPractica).toHaveBeenCalledTimes(1)
      expect(mem.escrituras).toEqual([])
    })
  }

  it("a database that fails while the order is looked up is a logged 500, not a 'not found'", async () => {
    const mem = montar("VENDEDOR", "v-a", { fallaLaBase: true })
    const registro = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const { status, body } = await respuestaDe(await llamar(c.control.orden ?? "o-a-libre"))

      expect(status).toBe(500)
      expect(body.error).not.toBe(noEncontrada)
      // The failure reaches the log (whichever way the route words it), with the database error in it.
      expect(registro.mock.calls.flat()).toContainEqual(expect.objectContaining({ code: "57014" }))
      expect(mem.escrituras).toEqual([])
      nadieSeEntero()
    } finally {
      registro.mockRestore()
    }
  })
})

describe("the ADMIN-only handlers refuse everybody else the same way for any id", () => {
  it.each([
    ["cobros DELETE", (id: string) => cobros.DELETE(sin("DELETE", id, "/cobros?cobroId=cb-1"), ctx(id))],
    ["cuotas PUT", (id: string) => cuotas.PUT(con("PUT", id, { cuotaId: "q-1" }), ctx(id))],
  ])("%s", async (_nombre, llamar) => {
    const mem = montar("VENDEDOR", "v-a")

    const fuera = await respuestaDe(await llamar("o-b-libre"))
    const inexistente = await respuestaDe(await llamar("no-existe"))

    expect(fuera.status).toBe(403)
    expect(fuera).toEqual(inexistente)
    expect(mem.escrituras).toEqual([])
  })
})

// The sub-routes were branch-level for a technician before the scope check and stay so (an org with
// one branch must not change, XC-3): a colleague's order of his own branch is open to him on every
// route that never narrowed him. The ones that did narrow him keep doing it themselves.
describe("a TECNICO on the sub-routes", () => {
  it.each([
    ["checklist GET", 200],
    ["repuestos POST", 201],
    ["servicios POST", 201],
    ["fotos GET", 200],
    ["fotos POST", 201],
    ["eventos GET", 200],
    ["cobros GET", 200],
    ["cuotas GET", 200],
  ])("%s on a colleague's order of his own branch is %s, as before", async (nombre, status) => {
    montar("TECNICO", "t-1")

    const { status: obtenido } = await respuestaDe(await caso(nombre).llamar("o-a-t2"))

    expect(obtenido).toBe(status)
  })

  it.each([
    ["entregar POST", 403, { error: "No autorizado" }],
    ["comprobante-entrega GET", 403, { error: "No autorizado" }],
    ["pdf GET", 403, { error: "No autorizado" }],
    ["notas-credito GET", 404, { error: ORDEN_NO_ENCONTRADA }],
  ])("%s on a colleague's order of his own branch keeps its own check: %s", async (nombre, status, body) => {
    const mem = montar("TECNICO", "t-1")

    expect(await respuestaDe(await caso(nombre).llamar("o-a-t2"))).toMatchObject({ status, body })
    expect(mem.escrituras).toEqual([])
  })

  it.each([
    ["repuestos POST", "o-b-t1", 201, { success: true }],
    ["fotos POST", "o-b-t1", 201, expect.objectContaining({ url: "https://x/y.png" })],
    ["checklist GET", "o-b-t1", 200, { checklist: null, template: { id: "tpl-1", nombre: "Basica", items: [] } }],
    ["entregar POST", "o-b-reparada-t1", 200, expect.objectContaining({ id: "o-b-reparada-t1", estado: "ENTREGADO" })],
  ])("%s on an order of ANOTHER branch assigned to him works (BM-6): %s", async (nombre, id, status, body) => {
    montar("TECNICO", "t-1")

    expect(await respuestaDe(await caso(nombre).llamar(id))).toMatchObject({ status, body })
  })
})

describe("tomar claims only the unassigned orders of the technician's own branch (OI-3)", () => {
  const tomarOrden = (id: string) => tomar.POST(con("POST", id, {}), ctx(id))

  it("an unassigned order of another branch is not found, and nothing is claimed", async () => {
    const mem = montar("TECNICO", "t-1")

    const fuera = await respuestaDe(await tomarOrden("o-b-libre"))
    const inexistente = await respuestaDe(await tomarOrden("no-existe"))

    expect(inexistente).toMatchObject({ status: 404, body: { error: ORDEN_NO_ENCONTRADA } })
    expect(fuera).toEqual(inexistente)
    expect(mem.escrituras).toEqual([])
    nadieSeEntero()
  })

  it("an unassigned order of his own branch is claimed for himself", async () => {
    const mem = montar("TECNICO", "t-1")

    const { status, body } = await respuestaDe(await tomarOrden("o-a-libre"))

    expect(status).toBe(200)
    expect(body).toEqual({ id: "o-a-libre", tecnicoId: "t-1" })
    expect(mem.escrituras).toContainEqual(
      expect.objectContaining({ tabla: "ordenes_servicio", operacion: "update", carga: expect.objectContaining({ tecnico_id: "t-1" }) }),
    )
    // He holds that one order; the rest of the table is as it was.
    expect(mem.filas("ordenes_servicio").filter((o) => o.tecnico_id === "t-1").map((o) => o.id).sort()).toEqual([
      "o-a-libre",
      "o-b-reparada-t1",
      "o-b-t1",
    ])
  })

  it("an order of his branch that has a technician is a conflict, not a claim", async () => {
    const mem = montar("TECNICO", "t-1")

    expect((await respuestaDe(await tomarOrden("o-a-t2"))).status).toBe(409)
    expect(mem.escrituras).toEqual([])
  })

  it("an order of another branch that is assigned to him is in his scope: a conflict, not 'not found' (BM-6)", async () => {
    const mem = montar("TECNICO", "t-1")

    expect((await respuestaDe(await tomarOrden("o-b-t1"))).status).toBe(409)
    expect(mem.escrituras).toEqual([])
  })

  it("a colleague's order of another branch is not found", async () => {
    montar("TECNICO", "t-1")

    expect(await respuestaDe(await tomarOrden("o-b-t2"))).toMatchObject({ status: 404, body: { error: ORDEN_NO_ENCONTRADA } })
  })
})
