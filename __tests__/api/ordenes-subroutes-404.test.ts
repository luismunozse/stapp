// @vitest-environment node
/**
 * Every sub-route of /api/ordenes/[id] answers within the caller's scope (change
 * sucursales-aislamiento, PR3; XC-1, XC-2, OI-1, OI-2).
 *
 * For each handler, a VENDEDOR or a TECNICO of branch A asking for an order of branch B gets
 * EXACTLY what a nonexistent id gets (status and body), and the request leaves nothing behind: no
 * insert, update, delete or RPC (so no stock move, no payment row, no installment), no client
 * notification (WhatsApp / email go through `queueNotification`), no webhook, no audit entry, no
 * stored or deleted photo.
 *
 * The tables are in-memory and honour their filters, so a handler that looks the order up wrongly
 * returns the wrong row. Each handler also gets a control call on an order of the caller's own
 * branch: it must get past the lookup (it is not answered "not found"), which keeps the table
 * honest about the request shapes it sends.
 */
import { describe, it, expect, vi } from "vitest"
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

const A = "suc-A"
const B = "suc-B"

const orden = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  numero_orden: 5,
  sucursal_id: A,
  tecnico_id: null,
  cliente_id: "c-1",
  estado: "RECIBIDO",
  tipo_dispositivo: "CELULAR",
  tipo_dispositivo_id: null,
  costo_final: 100,
  total_cobrado: 0,
  descuento_cobro: 0,
  estado_cobro: "PENDIENTE",
  fecha_completado: null,
  clientes: { id: "c-1", nombre: "Juan", email: null, telefono: "1" },
  notas_credito: [],
  ...extra,
})

const ORDENES = [
  orden("o-a-libre"),
  orden("o-a-t2", { tecnico_id: "t-2" }),
  orden("o-b-libre", { sucursal_id: B }),
  orden("o-b-t1", { sucursal_id: B, tecnico_id: "t-1" }),
  orden("o-b-t2", { sucursal_id: B, tecnico_id: "t-2" }),
]

const FOTOS = ["a", "b"].map((s) => ({
  id: `f-${s}`,
  orden_id: `o-${s}-libre`,
  storage_path: `org-1/o-${s}-libre/f.png`,
  url: "https://x/f.png",
  mime: "image/png",
  size: 3,
  descripcion: null,
  tipo: "INGRESO",
  created_at: "2026-01-01T00:00:00Z",
}))

function montar(role: string, userId: string) {
  vi.clearAllMocks()
  mockAuthSuccess({ role, userId, sucursalId: A })
  return montarSupabaseEnMemoria({
    ordenes_servicio: ORDENES,
    fotos_orden: FOTOS,
    repuestos_orden: [
      { id: "r-1", orden_id: "o-a-libre", inventario_id: "inv-1", cantidad: 1 },
      { id: "r-b", orden_id: "o-b-libre", inventario_id: "inv-1", cantidad: 1 },
    ],
    users: [{ id: "t-1", rol: "TECNICO", organization_id: "org-1", porcentaje_comision: 10, costo_hora: 100 }],
    organizations: [
      {
        id: "org-1",
        tecnicos_toman_ordenes: true,
        vendedores_manejan_caja: true,
        vendedores_administran_inventario: false,
        zona_horaria: "America/Argentina/Buenos_Aires",
      },
    ],
  })
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
  return { status: res.status, body: tipo.includes("json") ? await res.json() : null }
}

const url = (id: string, resto = "") => `http://localhost:3000/api/ordenes/${id}${resto}`
const ctx = <T extends Record<string, string>>(id: string, extra: T = {} as T) => ({
  params: Promise.resolve({ id, ...extra }),
})
const sin = (metodo: string, id: string, resto = "") => new Request(url(id, resto), { method: metodo })
const con = (metodo: string, id: string, cuerpo: unknown, resto = "") =>
  new Request(url(id, resto), { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })

/** The photo of an order, for the handlers that are given a photo and not an order. */
const fotoDe = (idOrden: string) => ({ "o-a-libre": "f-a", "o-b-libre": "f-b" })[idOrden] ?? "f-no-existe"

interface Caso {
  nombre: string
  /** `id` is the order the caller asks for; the handlers that take a photo get the photo of that order. */
  llamar: (id: string) => Promise<Response>
  /** What the caller is told for a missing order (and so for one out of scope). */
  noEncontrada: string
  /** Who reaches the order lookup: the others get the same 403 for every id before it. */
  roles?: Array<"VENDEDOR" | "TECNICO">
}

const ORDEN_NO_ENCONTRADA = "Orden no encontrada"

const CASOS: Caso[] = [
  { nombre: "checklist GET", llamar: (id) => checklist.GET(sin("GET", id), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  {
    nombre: "checklist POST",
    llamar: (id) => checklist.POST(con("POST", id, { templateId: "tpl-1", valores: {} }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  {
    nombre: "checklist PUT",
    llamar: (id) => checklist.PUT(con("PUT", id, { valores: { a: true } }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  { nombre: "checklist DELETE", llamar: (id) => checklist.DELETE(sin("DELETE", id), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  { nombre: "cobros GET", llamar: (id) => cobros.GET(sin("GET", id), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  {
    nombre: "cobros POST",
    llamar: (id) => cobros.POST(con("POST", id, { pagos: [{ monto: 100, metodo: "EFECTIVO" }] }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
    roles: ["VENDEDOR"],
  },
  { nombre: "comprobante-entrega GET", llamar: (id) => comprobanteEntrega.GET(sin("GET", id), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  { nombre: "cuotas GET", llamar: (id) => cuotas.GET(sin("GET", id), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  { nombre: "entregar POST", llamar: (id) => entregar.POST(con("POST", id, {}), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  { nombre: "eventos GET", llamar: (id) => eventos.GET(sin("GET", id), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  { nombre: "fotos GET", llamar: (id) => fotos.GET(sin("GET", id, "/fotos"), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  {
    nombre: "fotos POST",
    llamar: (id) => fotos.POST(con("POST", id, { data: "aGVsbG8=", mime: "image/png" }, "/fotos"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  {
    // The order in the path is the caller's own; the photo is the one of the order he asks about.
    nombre: "fotos DELETE",
    llamar: (id) => fotos.DELETE(sin("DELETE", "o-a-libre", `/fotos?fotoId=${fotoDe(id)}`), ctx("o-a-libre")),
    noEncontrada: "Foto no encontrada",
  },
  {
    nombre: "fotos/[fotoId] GET",
    llamar: (id) => foto.GET(sin("GET", id, `/fotos/${fotoDe(id)}`), ctx(id, { fotoId: fotoDe(id) })),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  { nombre: "notas-credito GET", llamar: (id) => notasCredito.GET(sin("GET", id), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  { nombre: "pdf GET", llamar: (id) => pdf.GET(sin("GET", id, "/pdf"), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
  {
    nombre: "reingreso POST",
    llamar: (id) => reingreso.POST(con("POST", id, { problemaReportado: "Volvió a fallar" }), ctx(id)),
    noEncontrada: "Orden original no encontrada",
    roles: ["VENDEDOR"],
  },
  {
    nombre: "repuestos POST",
    llamar: (id) =>
      repuestos.POST(con("POST", id, { tipo: "manual", nombre: "Pantalla", cantidad: 1, precioUnitario: 10 }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  {
    nombre: "repuestos PATCH",
    llamar: (id) => repuestos.PATCH(con("PATCH", id, { cantidad: 2 }, "/repuestos?repuestoId=r-1"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  {
    nombre: "repuestos DELETE",
    llamar: (id) => repuestos.DELETE(sin("DELETE", id, "/repuestos?repuestoId=r-1"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  {
    nombre: "servicios POST",
    llamar: (id) =>
      servicios.POST(con("POST", id, { tipo: "manual", nombre: "Mano de obra", cantidad: 1, precioUnitario: 100 }), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  {
    nombre: "servicios DELETE",
    llamar: (id) => servicios.DELETE(sin("DELETE", id, "/servicios?servicioOrdenId=s-1"), ctx(id)),
    noEncontrada: ORDEN_NO_ENCONTRADA,
  },
  { nombre: "servicios PATCH", llamar: (id) => servicios.PATCH(sin("PATCH", id, "/servicios"), ctx(id)), noEncontrada: ORDEN_NO_ENCONTRADA },
]

const ACTORES = { VENDEDOR: "v-a", TECNICO: "t-1" } as const

describe.each(CASOS)("$nombre", ({ llamar, noEncontrada, roles = ["VENDEDOR", "TECNICO"] }) => {
  it.each(roles)("a %s of A asking for an order of B gets what a missing id gets, and leaves nothing behind", async (rol) => {
    const mem = montar(rol, ACTORES[rol])

    const inexistente = await respuestaDe(await llamar("no-existe"))
    const fuera = await respuestaDe(await llamar("o-b-libre"))

    expect(inexistente).toEqual({ status: 404, body: { error: noEncontrada } })
    expect(fuera).toEqual(inexistente)
    expect(mem.escrituras).toEqual([])
    nadieSeEntero()
  })

  it("a VENDEDOR is not turned away at the lookup for an order of his own branch (control)", async () => {
    montar("VENDEDOR", ACTORES.VENDEDOR)

    const propia = await respuestaDe(await llamar("o-a-libre"))

    expect(propia.body?.error).not.toBe(noEncontrada)
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

describe("tomar claims only the unassigned orders of the technician's own branch (OI-3)", () => {
  const tomarOrden = (id: string) => tomar.POST(con("POST", id, {}), ctx(id))

  it("an unassigned order of another branch is not found, and nothing is claimed", async () => {
    const mem = montar("TECNICO", "t-1")

    const fuera = await respuestaDe(await tomarOrden("o-b-libre"))
    const inexistente = await respuestaDe(await tomarOrden("no-existe"))

    expect(inexistente).toEqual({ status: 404, body: { error: ORDEN_NO_ENCONTRADA } })
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

    expect(await respuestaDe(await tomarOrden("o-b-t2"))).toEqual({ status: 404, body: { error: ORDEN_NO_ENCONTRADA } })
  })
})
