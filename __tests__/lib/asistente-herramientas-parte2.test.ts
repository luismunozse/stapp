// @vitest-environment node
/**
 * Herramientas del asistente, parte 2: buscar_ordenes, resumen_cliente y resumen_ordenes.
 * Lo central es el alcance: mismas reglas que la pantalla Órdenes (sucursal para ADMIN/VENDEDOR,
 * técnico solo lo suyo) y la deuda de clientes oculta para técnicos salvo el permiso de la org.
 */
import { describe, it, expect } from "vitest"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { buscarOrdenes } from "@/lib/asistente/herramientas/buscar-ordenes"
import { resumenCliente } from "@/lib/asistente/herramientas/resumen-cliente"
import { resumenOrdenes } from "@/lib/asistente/herramientas/resumen-ordenes"

const A = "suc-A"
const B = "suc-B"
const AYER = new Date(Date.now() - 86_400_000).toISOString()
const MANANA = new Date(Date.now() + 86_400_000).toISOString()

let n = 0
const orden = (extra: Record<string, unknown> = {}) => {
  n++
  return {
    id: `o-${n}`,
    organization_id: "org-1",
    sucursal_id: A,
    tecnico_id: null,
    cliente_id: "c-juan",
    numero_orden: n,
    codigo_orden: `CEL-${String(n).padStart(4, "0")}`,
    estado: "EN_REPARACION",
    tipo_dispositivo: "Celular",
    dispositivo: "iPhone 13",
    marca: "Apple",
    imei: null,
    fecha_ingreso: new Date().toISOString(),
    fecha_prometida: MANANA,
    fecha_entrega: null,
    costo_final: null,
    total_cobrado: 0,
    descuento_cobro: 0,
    estado_cobro: "PENDIENTE",
    clientes: { nombre: "Juan Pérez" },
    users: null,
    notas_credito: [],
    ...extra,
  }
}

const ctx = (role: string, sucursalId: string | null, userId: string, verTodas = role === "ADMIN") => ({
  actor: { organizationId: "org-1", userId, role, sucursalId },
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  filtroLectura: { verTodas, sucursalId: verTodas ? null : sucursalId },
})
const admin = ctx("ADMIN", null, "adm")
const vendedorA = ctx("VENDEDOR", A, "v-a")
const tecnico1 = ctx("TECNICO", A, "t-1")

const CLIENTES = [
  { id: "c-juan", organization_id: "org-1", nombre: "Juan Pérez", telefono: "3511111111", email: null },
  { id: "c-ana", organization_id: "org-1", nombre: "Ana Gómez", telefono: "3512222222", email: "ana@x.com" },
  { id: "c-otra", organization_id: "org-2", nombre: "Juan Otro", telefono: "999", email: null },
]

function montar(ordenes: Record<string, unknown>[], org: Record<string, unknown> = {}) {
  return montarSupabaseEnMemoria(
    {
      ordenes_servicio: ordenes,
      clientes: CLIENTES,
      organizations: [{ id: "org-1", tecnicos_toman_ordenes: false, tecnicos_ven_deuda_clientes: false, ...org }],
    },
    { resultadoRpc: () => [{ deuda_total: 15000, deuda_fiado: 5000, deuda_ordenes: 10000 }] }
  )
}

const codigos = (datos: any) => datos.ordenes.map((o: any) => o.codigo)

describe("buscar_ordenes", () => {
  it("atrasadas: solo las abiertas con fecha prometida vencida", async () => {
    const vencida = orden({ fecha_prometida: AYER })
    const entregadaVencida = orden({ fecha_prometida: AYER, estado: "ENTREGADO" })
    const aTiempo = orden()
    montar([vencida, entregadaVencida, aTiempo])
    const { datos } = await buscarOrdenes.ejecutar({ atrasadas: true }, admin)
    expect(codigos(datos)).toEqual([vencida.codigo_orden])
    expect((datos as any).ordenes[0]).toMatchObject({ atrasada: true, link: `/ordenes/${vencida.id}` })
  })

  it("un vendedor solo ve su sucursal y el total respeta el alcance", async () => {
    const enA = orden()
    montar([enA, orden({ sucursal_id: B }), orden({ organization_id: "org-2" })])
    const { datos } = await buscarOrdenes.ejecutar({}, vendedorA)
    expect(codigos(datos)).toEqual([enA.codigo_orden])
    expect((datos as any).total).toBe(1)
  })

  it("un técnico solo ve las suyas, de cualquier sucursal", async () => {
    const mia = orden({ tecnico_id: "t-1", sucursal_id: B })
    montar([mia, orden({ tecnico_id: "t-2" }), orden()])
    const { datos } = await buscarOrdenes.ejecutar({}, tecnico1)
    expect(codigos(datos)).toEqual([mia.codigo_orden])
  })

  it("con tecnicos_toman_ordenes, el técnico ve además las sin asignar de su sucursal", async () => {
    const mia = orden({ tecnico_id: "t-1" })
    const libreA = orden()
    montar([mia, libreA, orden({ sucursal_id: B }), orden({ tecnico_id: "t-2" })], { tecnicos_toman_ordenes: true })
    const { datos } = await buscarOrdenes.ejecutar({}, tecnico1)
    expect(codigos(datos).sort()).toEqual([mia.codigo_orden, libreA.codigo_orden].sort())
  })

  it("texto busca por nombre de cliente sin salirse del alcance", async () => {
    const deJuan = orden()
    const deAna = orden({ cliente_id: "c-ana", clientes: { nombre: "Ana Gómez" } })
    const deJuanEnB = orden({ sucursal_id: B })
    montar([deJuan, deAna, deJuanEnB])
    const { datos } = await buscarOrdenes.ejecutar({ texto: "juan" }, vendedorA)
    expect(codigos(datos)).toEqual([deJuan.codigo_orden])
  })

  it("un texto con comas o paréntesis no rompe el filtro del alcance", async () => {
    montar([orden({ sucursal_id: B })])
    const { datos } = await buscarOrdenes.ejecutar({ texto: "x),sucursal_id.eq.suc-B" }, vendedorA)
    expect((datos as any).ordenes).toEqual([])
  })

  it("cobro pendiente: reparadas o entregadas con saldo", async () => {
    const debe = orden({ estado: "REPARADO", costo_final: 30000, total_cobrado: 10000, estado_cobro: "PARCIAL" })
    montar([debe, orden({ estado: "REPARADO", costo_final: 30000, total_cobrado: 30000, estado_cobro: "COBRADO" }), orden()])
    const { datos } = await buscarOrdenes.ejecutar({ cobro_pendiente: true }, admin)
    expect(codigos(datos)).toEqual([debe.codigo_orden])
    expect((datos as any).ordenes[0].saldoPendiente).toBe(20000)
  })

  it("rechaza un estado o una fecha inválidos", async () => {
    montar([])
    await expect(buscarOrdenes.ejecutar({ estado: "INVENTADO" }, admin)).rejects.toThrow()
    await expect(buscarOrdenes.ejecutar({ ingresadas_desde: "ayer" }, admin)).rejects.toThrow()
  })
})

describe("resumen_cliente", () => {
  it("un admin ve la deuda y las órdenes del cliente; nunca clientes de otra org", async () => {
    const mem = montar([orden()])
    const { datos } = await resumenCliente.ejecutar({ busqueda: "juan" }, admin)
    expect((datos as any).clientes).toHaveLength(1)
    expect((datos as any).clientes[0]).toMatchObject({
      nombre: "Juan Pérez",
      link: "/clientes/c-juan",
      deuda: { total: 15000, fiado: 5000, ordenes: 10000 },
    })
    expect((datos as any).clientes[0].ultimasOrdenes).toHaveLength(1)
    const rpc = mem.escrituras.find((e) => e.operacion === "rpc")
    expect(rpc?.carga).toEqual({ p_org_id: "org-1", p_cliente_id: "c-juan", p_sucursal_id: null })
  })

  it("la deuda de un vendedor se calcula para su sucursal", async () => {
    const mem = montar([])
    await resumenCliente.ejecutar({ busqueda: "ana" }, vendedorA)
    expect(mem.escrituras.find((e) => e.operacion === "rpc")?.carga).toMatchObject({ p_sucursal_id: A })
  })

  it("un técnico NO ve la deuda sin el permiso, y ni se consulta", async () => {
    const mem = montar([])
    const { datos } = await resumenCliente.ejecutar({ busqueda: "juan" }, tecnico1)
    expect((datos as any).clientes[0].deuda).toBe("sin permiso para ver la deuda")
    expect(mem.escrituras.filter((e) => e.operacion === "rpc")).toHaveLength(0)
  })

  it("un técnico SÍ ve la deuda cuando el admin activó tecnicos_ven_deuda_clientes", async () => {
    montar([], { tecnicos_ven_deuda_clientes: true })
    const { datos } = await resumenCliente.ejecutar({ busqueda: "juan" }, tecnico1)
    expect((datos as any).clientes[0].deuda).toEqual({ total: 15000, fiado: 5000, ordenes: 10000 })
  })

  it("las órdenes del cliente respetan el alcance del técnico", async () => {
    montar([orden({ tecnico_id: "t-2" }), orden({ tecnico_id: "t-1" })])
    const { datos } = await resumenCliente.ejecutar({ busqueda: "juan" }, tecnico1)
    expect((datos as any).clientes[0].ultimasOrdenes).toHaveLength(1)
  })

  it("sin coincidencias lo dice", async () => {
    montar([])
    const { datos, filas } = await resumenCliente.ejecutar({ busqueda: "zzz" }, admin)
    expect(filas).toBe(0)
    expect(datos).toMatchObject({ encontrados: 0 })
  })
})

describe("resumen_ordenes", () => {
  it("cuenta abiertas por estado, atrasadas y saldo pendiente dentro del alcance", async () => {
    montar([
      orden({ estado: "EN_REPARACION", fecha_prometida: AYER }),
      orden({ estado: "ESPERANDO_REPUESTO" }),
      orden({ estado: "REPARADO", costo_final: 20000, total_cobrado: 5000, estado_cobro: "PARCIAL" }),
      orden({ estado: "ENTREGADO", costo_final: 10000, total_cobrado: 10000, estado_cobro: "COBRADO", fecha_entrega: new Date().toISOString() }),
      orden({ sucursal_id: B, estado: "EN_REPARACION", fecha_prometida: AYER }),
    ])
    const { datos } = await resumenOrdenes.ejecutar({}, vendedorA)
    expect(datos).toMatchObject({
      enElPeriodo: { ingresadas: 4, entregadas: 1, facturadoEntregadas: 10000 },
      hoy: { abiertas: 3, atrasadas: 1, ordenesConSaldo: 1, saldoPendienteTotal: 15000 },
    })
    expect((datos as any).hoy.abiertasPorEstado).toEqual({ "En reparación": 1, "Esperando repuesto": 1, "Reparado": 1 })
  })

  it("un técnico solo cuenta sus órdenes", async () => {
    montar([orden({ tecnico_id: "t-1" }), orden({ tecnico_id: "t-2" }), orden()])
    const { datos } = await resumenOrdenes.ejecutar({}, tecnico1)
    expect((datos as any).hoy.abiertas).toBe(1)
  })
})
