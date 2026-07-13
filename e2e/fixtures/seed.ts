import type { APIRequestContext } from "@playwright/test"

/**
 * Seed mínimo vía API autenticada.
 *
 * Garantiza los prerrequisitos de los specs autenticados: al menos un cliente y
 * una orden de prueba en el tenant QA. Es IDEMPOTENTE — usa marcadores estables
 * y reusa lo existente, así que correrlo N veces deja el mismo estado.
 *
 * Va a través de las MISMAS rutas REST de la app (POST /api/clientes,
 * /api/ordenes), por lo que respeta validación Zod, límites de plan, contadores
 * de número de orden y multi-tenancy. No toca la DB por fuera.
 *
 * El `request` debe estar autenticado (cookies de sesión del storageState) y
 * apuntar al subdominio del tenant para que el middleware inyecte x-tenant-slug.
 */

export const SEED = {
  clienteNombre: "QA-SEED-CLIENTE",
  clienteTelefono: "1100000001",
  ordenDispositivo: "QA-SEED-EQUIPO",
  ordenProblema: "Equipo de prueba E2E — no enciende",
  // Usuarios. Email es ÚNICO GLOBAL en STApp (el chequeo no filtra por org),
  // por eso usamos direcciones namespaced poco probables de colisionar.
  tecnicoNombre: "QA-SEED-TECNICO",
  tecnicoEmail: "qa-seed-tecnico@e2e.local",
  vendedorNombre: "QA-SEED-VENDEDOR",
  vendedorEmail: "qa-seed-vendedor@e2e.local",
  usuarioPassword: "Passw0rd!E2E",
  /** Substring común para buscar lo sembrado por la app (search ilike). */
  marker: "QA-SEED",
} as const

export interface SeedResult {
  clienteId: string
  ordenId: string
  ordenCodigo: string | null
  tipoDispositivo: string
  tecnicoId: string
  vendedorId: string
}

async function jsonOrThrow(res: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<any> }, ctx: string) {
  if (!res.ok()) {
    const body = await res.text().catch(() => "")
    throw new Error(`Seed: ${ctx} respondió ${res.status()} — ${body.slice(0, 300)}`)
  }
  return res.json()
}

/** Devuelve el código de un tipo de dispositivo válido (auto-sembrado por la app). */
async function getTipoDispositivo(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/tipos-dispositivo")
  const tipos = await jsonOrThrow(res, "GET /api/tipos-dispositivo")
  // El endpoint auto-crea los tipos base si la org no tiene ninguno.
  const codigo = Array.isArray(tipos) && tipos.length > 0 ? tipos[0].codigo : "CELULAR"
  return codigo
}

async function ensureCliente(request: APIRequestContext): Promise<string> {
  const existing = await jsonOrThrow(
    await request.get(`/api/clientes?search=${encodeURIComponent(SEED.marker)}&limit=1`),
    "GET /api/clientes",
  )
  if (existing?.data?.length) return existing.data[0].id

  const res = await request.post("/api/clientes", {
    data: { nombre: SEED.clienteNombre, telefono: SEED.clienteTelefono },
  })
  // Si otra corrida lo creó en paralelo (teléfono duplicado), reconsultar.
  if (res.status() === 400) {
    const retry = await jsonOrThrow(
      await request.get(`/api/clientes?search=${encodeURIComponent(SEED.marker)}&limit=1`),
      "GET /api/clientes (retry)",
    )
    if (retry?.data?.length) return retry.data[0].id
  }
  const cliente = await jsonOrThrow(res, "POST /api/clientes")
  return cliente.id
}

async function ensureOrden(
  request: APIRequestContext,
  clienteId: string,
  tipoDispositivo: string,
): Promise<{ id: string; codigo: string | null }> {
  const existing = await jsonOrThrow(
    await request.get(`/api/ordenes?search=${encodeURIComponent(SEED.marker)}&limit=1`),
    "GET /api/ordenes",
  )
  if (existing?.data?.length) {
    const o = existing.data[0]
    return { id: o.id, codigo: o.codigoOrden ?? o.codigo_orden ?? null }
  }

  const orden = await jsonOrThrow(
    await request.post("/api/ordenes", {
      data: {
        clienteId,
        dispositivo: SEED.ordenDispositivo,
        tipoDispositivo,
        problemaReportado: SEED.ordenProblema,
      },
    }),
    "POST /api/ordenes",
  )
  return { id: orden.id, codigo: orden.codigoOrden ?? null }
}

/**
 * Técnico de prueba. POST /api/tecnicos requiere ADMIN. GET /api/tecnicos
 * devuelve un ARRAY (sin search) -> filtramos por email en cliente.
 */
async function ensureTecnico(request: APIRequestContext): Promise<string> {
  const tecnicos = await jsonOrThrow(await request.get("/api/tecnicos"), "GET /api/tecnicos")
  const found = Array.isArray(tecnicos) ? tecnicos.find((t: any) => t.email === SEED.tecnicoEmail) : null
  if (found) return found.id

  const res = await request.post("/api/tecnicos", {
    data: {
      nombre: SEED.tecnicoNombre,
      email: SEED.tecnicoEmail,
      password: SEED.usuarioPassword,
      porcentajeComision: 10,
    },
  })
  // Email duplicado (creado en paralelo) -> reconsultar el array.
  if (res.status() === 400) {
    const retry = await jsonOrThrow(await request.get("/api/tecnicos"), "GET /api/tecnicos (retry)")
    const t = Array.isArray(retry) ? retry.find((x: any) => x.email === SEED.tecnicoEmail) : null
    if (t) return t.id
  }
  const tecnico = await jsonOrThrow(res, "POST /api/tecnicos")
  return tecnico.id
}

/**
 * Vendedor de prueba. POST /api/vendedores requiere ADMIN. GET soporta ?search.
 */
async function ensureVendedor(request: APIRequestContext): Promise<string> {
  const existing = await jsonOrThrow(
    await request.get(`/api/vendedores?search=${encodeURIComponent(SEED.vendedorEmail)}&limit=1`),
    "GET /api/vendedores",
  )
  const match = existing?.data?.find((v: any) => v.email === SEED.vendedorEmail)
  if (match) return match.id

  const res = await request.post("/api/vendedores", {
    data: {
      nombre: SEED.vendedorNombre,
      email: SEED.vendedorEmail,
      password: SEED.usuarioPassword,
      porcentajeComision: 10,
    },
  })
  if (res.status() === 400) {
    const retry = await jsonOrThrow(
      await request.get(`/api/vendedores?search=${encodeURIComponent(SEED.vendedorEmail)}&limit=1`),
      "GET /api/vendedores (retry)",
    )
    const v = retry?.data?.find((x: any) => x.email === SEED.vendedorEmail)
    if (v) return v.id
  }
  const vendedor = await jsonOrThrow(res, "POST /api/vendedores")
  return vendedor.id
}

export async function ensureSeedData(request: APIRequestContext): Promise<SeedResult> {
  const tipoDispositivo = await getTipoDispositivo(request)
  const clienteId = await ensureCliente(request)
  const orden = await ensureOrden(request, clienteId, tipoDispositivo)
  // Técnico y vendedor requieren rol ADMIN del usuario del seed.
  const tecnicoId = await ensureTecnico(request)
  const vendedorId = await ensureVendedor(request)
  return {
    clienteId,
    ordenId: orden.id,
    ordenCodigo: orden.codigo,
    tipoDispositivo,
    tecnicoId,
    vendedorId,
  }
}
