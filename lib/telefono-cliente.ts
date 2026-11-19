import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"

/**
 * Teléfono del cliente oculto para los técnicos (migración 416).
 *
 * El administrador puede apagar `organizations.tecnicos_ven_telefono_clientes`. Con el permiso
 * apagado, un usuario TECNICO no recibe el teléfono de ningún cliente: el servidor lo quita de
 * cada respuesta (pantallas, PDF, exportaciones, asistente) y no lo deja buscar por teléfono,
 * porque una búsqueda por dígitos lo revelaría de a poco. Ocultarlo solo en pantalla no alcanza:
 * el número seguiría viajando al navegador.
 *
 * ADMIN y VENDEDOR lo ven siempre. Los avisos automáticos al cliente no dependen de esto: los
 * envía el servidor, que sí conoce el número.
 */

/**
 * Lee el permiso tal como está guardado. `undefined` = la columna todavía no existe (las
 * migraciones se aplican a mano, después del deploy). Lanza si la lectura falla por otra cosa.
 */
export async function leerTecnicosVenTelefonoClientes(organizationId: string): Promise<boolean | undefined> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("tecnicos_ven_telefono_clientes")
    .eq("id", organizationId)
    .single()
  if (error) {
    if (isMissingColumnError(error)) return undefined
    throw error
  }
  // Solo un false EXPLÍCITO lo oculta.
  return (data as { tecnicos_ven_telefono_clientes?: boolean | null } | null)?.tecnicos_ven_telefono_clientes !== false
}

/**
 * Resuelve el permiso de la organización. Solo hace falta para un TECNICO.
 *
 * - Columna sin migrar: `true`, que es el comportamiento de siempre. Nadie pudo haberlo
 *   apagado todavía.
 * - Cualquier otra falla de lectura: `false`. Si el taller lo apagó, un error transitorio no
 *   puede volver a mostrar los teléfonos.
 */
export async function resolveTecnicosVenTelefonoClientes(organizationId: string): Promise<boolean> {
  try {
    return (await leerTecnicosVenTelefonoClientes(organizationId)) ?? true
  } catch {
    return false
  }
}

/** ¿Este usuario puede ver el teléfono de los clientes? Solo el TECNICO depende del permiso. */
export async function puedeVerTelefonoClientes(
  role: string | null | undefined,
  organizationId: string
): Promise<boolean> {
  if (role !== "TECNICO") return true
  return resolveTecnicosVenTelefonoClientes(organizationId)
}

/** Claves que llevan un teléfono de cliente en las respuestas (camelCase) y en las filas (snake_case). */
const CLAVES_TELEFONO_CLIENTE = new Set([
  "telefono",
  "telefonoContacto",
  "telefono_contacto",
  "clienteTelefono",
  "cliente_telefono",
  "contactoTelefono",
  "contacto_telefono",
])

/**
 * Ramas que NO son del cliente aunque tengan una clave `telefono`: el taller, la sucursal, el
 * personal y los proveedores. No se tocan.
 */
const RAMAS_AJENAS = new Set([
  "organizations",
  "organization",
  "organizacion",
  "sucursal",
  "sucursales",
  "users",
  "user",
  "tecnico",
  "vendedor",
  "recibido",
  "recibidoPor",
  "proveedor",
  "proveedores",
])

/**
 * Devuelve una copia de `dato` con todos los teléfonos de cliente en `null`, a cualquier
 * profundidad. Pensado para el objeto del cliente, la orden, la venta, el turno o la cotización
 * ya formateados: lo que venga anidado (cliente dentro de la orden, sectores dentro del cliente)
 * queda cubierto sin que cada ruta tenga que acordarse.
 */
export function sinTelefonoCliente<T>(dato: T): T {
  if (Array.isArray(dato)) return dato.map((d) => sinTelefonoCliente(d)) as unknown as T
  if (!dato || typeof dato !== "object" || dato instanceof Date) return dato
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(dato as Record<string, unknown>)) {
    if (CLAVES_TELEFONO_CLIENTE.has(clave)) salida[clave] = null
    else if (RAMAS_AJENAS.has(clave)) salida[clave] = valor
    else salida[clave] = sinTelefonoCliente(valor)
  }
  return salida as T
}

/** `sinTelefonoCliente` solo cuando corresponde ocultar; si no, el dato tal cual. */
export function conTelefonoSegunPermiso<T>(dato: T, verTelefono: boolean): T {
  return verTelefono ? dato : sinTelefonoCliente(dato)
}
