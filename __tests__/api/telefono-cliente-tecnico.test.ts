/**
 * Teléfono del cliente oculto para los técnicos (migración 416): con
 * `tecnicos_ven_telefono_clientes` apagado, un TECNICO no recibe el teléfono de ningún cliente.
 *
 *  - Lista de clientes: sin teléfono, sin ordenar ni buscar por él.
 *  - Detalle: sin teléfono del cliente ni de los contactos de sus sectores.
 *  - Edición: el teléfono que mande no se guarda.
 *  - ADMIN y VENDEDOR no cambian; sin la columna (migración pendiente), tampoco el TECNICO.
 */
import { describe, it, expect } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

import { GET as getLista } from "@/app/api/clientes/route"
import { GET as getCliente, PUT as putCliente } from "@/app/api/clientes/[id]/route"
import {
  conTelefonoSegunPermiso,
  puedeVerTelefonoClientes,
  sinTelefonoCliente,
} from "@/lib/telefono-cliente"

const params = () => ({ params: Promise.resolve({ id: "cli-1" }) })
const FILA = { id: "cli-1", nombre: "Ana", telefono: "3515550000", saldo_cuenta: "0", deuda_pendiente: "0" }
const SECTOR = { id: "sec-1", nombre: "Compras", contacto_nombre: "Luz", contacto_telefono: "3514440000", activo: true }

function montar(org: Record<string, unknown> | null, errorOrg: unknown = null) {
  const vista = createChainMock([FILA])
  const clientes = createChainMock({ ...FILA, ordenes_servicio: [], sectores_cliente: [SECTOR] })
  mockSupabaseFrom({
    v_clientes_resumen: vista,
    clientes,
    organizations: createChainMock(org, errorOrg),
  })
  return { vista, clientes }
}

const lista = (qs = "") => getLista(createGetRequest(`http://localhost/api/clientes${qs}`))

describe("lista de clientes", () => {
  it("TECNICO con el permiso apagado: sin teléfono, sin orden ni búsqueda por teléfono", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    const { vista } = montar({ tecnicos_ven_telefono_clientes: false })
    const { status, body } = await parseResponse(await lista("?search=351&sortBy=telefono"))
    expect(status).toBe(200)
    expect(body.data[0].telefono).toBeNull()
    expect(body.data[0].nombre).toBe("Ana")
    expect(body.telefonoOculto).toBe(true)
    expect(vista.order).not.toHaveBeenCalledWith("telefono", expect.anything())
    for (const [filtro] of vista.or.mock.calls) expect(filtro).not.toContain("telefono")
  })

  it("TECNICO con el permiso prendido: lo ve y puede buscar por él", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    const { vista } = montar({ tecnicos_ven_telefono_clientes: true })
    const { body } = await parseResponse(await lista("?search=351"))
    expect(body.data[0].telefono).toBe("3515550000")
    expect(body.telefonoOculto).toBe(false)
    expect(vista.or.mock.calls[0][0]).toContain("telefono.ilike")
  })

  it.each(["ADMIN", "VENDEDOR"])("%s lo ve aunque el permiso esté apagado", async (role) => {
    mockAuthSuccess({ role, sucursalId: role === "VENDEDOR" ? "s1" : null })
    montar({ tecnicos_ven_telefono_clientes: false })
    const { body } = await parseResponse(await lista())
    expect(body.data[0].telefono).toBe("3515550000")
    expect(body.telefonoOculto).toBe(false)
  })
})

describe("detalle y edición del cliente", () => {
  it("TECNICO con el permiso apagado: ni el teléfono del cliente ni el del contacto del sector", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    montar({ tecnicos_ven_telefono_clientes: false })
    const { body } = await parseResponse(await getCliente(createGetRequest(), params()))
    expect(body.telefono).toBeNull()
    expect(body.sectores[0].contactoTelefono).toBeNull()
    expect(body.sectores[0].contactoNombre).toBe("Luz")
    expect(body.telefonoOculto).toBe(true)
  })

  it("TECNICO con el permiso apagado: el teléfono que mande al editar no se guarda", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "s1" })
    const { clientes } = montar({ tecnicos_ven_telefono_clientes: false })
    const req = new Request("http://localhost/api/clientes/cli-1", {
      method: "PUT",
      body: JSON.stringify({ nombre: "Ana María", telefono: "1111111111" }),
    })
    const { status, body } = await parseResponse(await putCliente(req, params()))
    expect(status).toBe(200)
    expect(clientes.update).toHaveBeenCalledWith({ nombre: "Ana María" })
    expect(body.telefono).toBeNull()
  })

  it("ADMIN edita el teléfono como siempre", async () => {
    mockAuthSuccess({ role: "ADMIN", sucursalId: null })
    const { clientes } = montar({ tecnicos_ven_telefono_clientes: false })
    const req = new Request("http://localhost/api/clientes/cli-1", {
      method: "PUT",
      body: JSON.stringify({ telefono: "1111111111" }),
    })
    await putCliente(req, params())
    expect(clientes.update).toHaveBeenCalledWith({ telefono: "1111111111" })
  })
})

describe("resolución del permiso", () => {
  it("sin la columna (migración pendiente) el TECNICO sigue viendo: nadie pudo apagarlo", async () => {
    montar(null, { code: "42703", message: "column organizations.tecnicos_ven_telefono_clientes does not exist" })
    expect(await puedeVerTelefonoClientes("TECNICO", "org-1")).toBe(true)
  })

  it("si la lectura falla por otra cosa, se oculta", async () => {
    montar(null, { code: "57014", message: "canceling statement due to statement timeout" })
    expect(await puedeVerTelefonoClientes("TECNICO", "org-1")).toBe(false)
  })

  it("ADMIN y VENDEDOR no consultan el permiso", async () => {
    montar(null, { code: "57014", message: "timeout" })
    expect(await puedeVerTelefonoClientes("ADMIN", "org-1")).toBe(true)
    expect(await puedeVerTelefonoClientes("VENDEDOR", "org-1")).toBe(true)
  })
})

describe("sinTelefonoCliente", () => {
  const orden = {
    id: "o1",
    telefonoContacto: "111",
    cliente: { nombre: "Ana", telefono: "222" },
    clientes: { nombre: "Ana", telefono: "222" },
    sector: { contactoNombre: "Luz", contactoTelefono: "333" },
    clienteSnapshot: { nombre: "Nuevo", telefono: "444" },
    tecnico: { nombre: "Tomi", telefono: "555" },
    organizations: { nombre: "Taller", telefono: "666" },
    sucursal: { nombre: "Centro", telefono: "777" },
  }

  it("borra los teléfonos del cliente a cualquier profundidad", () => {
    const r = sinTelefonoCliente(orden)
    expect(r.telefonoContacto).toBeNull()
    expect(r.cliente).toEqual({ nombre: "Ana", telefono: null })
    expect(r.clientes.telefono).toBeNull()
    expect(r.sector.contactoTelefono).toBeNull()
    expect(r.clienteSnapshot.telefono).toBeNull()
    expect(sinTelefonoCliente([{ cliente_telefono: "1", telefono_contacto: "2", contacto_telefono: "3" }])).toEqual([
      { cliente_telefono: null, telefono_contacto: null, contacto_telefono: null },
    ])
  })

  it("no toca los teléfonos del taller, la sucursal ni el personal", () => {
    const r = sinTelefonoCliente(orden)
    expect(r.tecnico.telefono).toBe("555")
    expect(r.organizations.telefono).toBe("666")
    expect(r.sucursal.telefono).toBe("777")
  })

  it("no modifica el original y deja el dato igual cuando hay permiso", () => {
    sinTelefonoCliente(orden)
    expect(orden.cliente.telefono).toBe("222")
    expect(conTelefonoSegunPermiso(orden, true)).toBe(orden)
  })
})
