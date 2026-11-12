// @vitest-environment node
/**
 * Herramienta `ver_orden` del asistente: devuelve solo órdenes que el usuario puede abrir en el
 * panel (misma puerta que el detalle: cargarOrdenEnAlcance). Fuera de alcance = no existe.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { verOrden } from "@/lib/asistente/herramientas/ver-orden"

const A = "suc-A"
const B = "suc-B"

const orden = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  sucursal_id: A,
  tecnico_id: null,
  numero_orden: 12,
  codigo_orden: "CEL-0012",
  estado: "REPARADO",
  tipo_dispositivo: "Celular",
  dispositivo: "iPhone 13",
  marca: "Apple",
  problema_reportado: "No carga",
  diagnostico: "Pin de carga",
  fecha_ingreso: "2026-11-01T10:00:00Z",
  fecha_prometida: "2026-11-05T10:00:00Z",
  fecha_entrega: null,
  presupuesto: 50000,
  costo_final: 50000,
  total_cobrado: 20000,
  descuento_cobro: 0,
  estado_cobro: "PARCIAL",
  clientes: { nombre: "Juan Pérez" },
  users: null,
  notas_credito: [],
  ...extra,
})

const ctx = (role: string, sucursalId: string | null, userId: string) => ({
  actor: { organizationId: "org-1", userId, role, sucursalId },
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  filtroLectura: { verTodas: role === "ADMIN", sucursalId: role === "ADMIN" ? null : sucursalId },
})
const admin = ctx("ADMIN", null, "adm")
const vendedorA = ctx("VENDEDOR", A, "v-a")
const tecnico1 = ctx("TECNICO", A, "t-1")

function montar(ordenes: Record<string, unknown>[]) {
  montarSupabaseEnMemoria({
    ordenes_servicio: ordenes,
    organizations: [{ id: "org-1", tecnicos_toman_ordenes: false }],
  })
}

describe("ver_orden", () => {
  beforeEach(() => montar([orden("o-1")]))

  it("busca por número y calcula el saldo pendiente", async () => {
    const { datos, filas } = await verOrden.ejecutar({ numero: "12" }, admin)
    expect(filas).toBe(1)
    expect(datos).toMatchObject({
      encontrada: true,
      moneda: "ARS",
      ordenes: [{ id: "o-1", link: "/ordenes/o-1", codigo: "CEL-0012", cliente: "Juan Pérez", tecnico: "Sin asignar", costoFinal: 50000, saldoPendiente: 30000 }],
    })
  })

  it("busca por código sin importar mayúsculas y con #", async () => {
    expect((await verOrden.ejecutar({ numero: "cel-0012" }, admin)).filas).toBe(1)
    expect((await verOrden.ejecutar({ numero: "#12" }, admin)).filas).toBe(1)
  })

  it("una orden de otra organización no existe", async () => {
    montar([orden("o-x", { organization_id: "org-2" })])
    const { datos, filas } = await verOrden.ejecutar({ numero: "12" }, admin)
    expect(filas).toBe(0)
    expect(datos).toMatchObject({ encontrada: false })
  })

  it("un vendedor de A no ve una orden de la sucursal B", async () => {
    montar([orden("o-b", { sucursal_id: B })])
    expect((await verOrden.ejecutar({ numero: "12" }, vendedorA)).filas).toBe(0)
  })

  it("un técnico no ve la orden de otro técnico, pero sí la suya", async () => {
    montar([orden("o-t2", { tecnico_id: "t-2" })])
    expect((await verOrden.ejecutar({ numero: "12" }, tecnico1)).filas).toBe(0)

    montar([orden("o-t1", { tecnico_id: "t-1", users: { nombre: "Tito" } })])
    const { datos, filas } = await verOrden.ejecutar({ numero: "12" }, tecnico1)
    expect(filas).toBe(1)
    expect(datos).toMatchObject({ ordenes: [{ tecnico: "Tito" }] })
  })

  it("con el mismo número en dos tipos devuelve solo las que el actor puede ver", async () => {
    montar([orden("o-a"), orden("o-b", { sucursal_id: B, codigo_orden: "TAB-0012" })])
    expect((await verOrden.ejecutar({ numero: "12" }, admin)).filas).toBe(2)
    const { datos } = await verOrden.ejecutar({ numero: "12" }, vendedorA)
    expect(datos).toMatchObject({ ordenes: [{ id: "o-a" }] })
  })

  it("rechaza un input inválido", async () => {
    await expect(verOrden.ejecutar({ numero: "" }, admin)).rejects.toThrow()
    await expect(verOrden.ejecutar({}, admin)).rejects.toThrow()
  })
})
