import { supabaseAdmin } from "@/lib/supabase"

export interface SucursalWhatsAppRow {
  evolution_instance_name: string | null
  evolution_connection_state: string | null
  activo: boolean
}

export async function getSucursalWhatsAppConfig(
  organizationId: string,
  sucursalId: string
): Promise<SucursalWhatsAppRow | null> {
  const { data, error } = await supabaseAdmin
    .from("sucursal_whatsapp_config")
    .select("evolution_instance_name, evolution_connection_state, activo")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle()

  if (error) {
    console.error("getSucursalWhatsAppConfig: error consultando sucursal_whatsapp_config", error)
  }

  return (data as SucursalWhatsAppRow | null) ?? null
}

/** Estado + timestamp de QR: mismo payload para el upsert del connect y el update del poll. */
function statePayload(state: string, opts?: { qr?: boolean }) {
  return {
    evolution_connection_state: state,
    ...(opts?.qr ? { evolution_last_qr_at: new Date().toISOString() } : {}),
  }
}

/**
 * Crea o pisa la fila de la sucursal. Llamar SOLO después de que
 * createInstance/connectInstance hayan corrido contra Evolution: una fila con
 * instance_name implica que la instancia existe en el servidor. Desde un poll
 * o cualquier camino que no cree la instancia, usar updateSucursalWhatsAppState.
 */
export async function upsertSucursalWhatsAppState(
  organizationId: string,
  sucursalId: string,
  instanceName: string,
  state: string,
  opts?: { qr?: boolean }
): Promise<void> {
  const { error } = await supabaseAdmin.from("sucursal_whatsapp_config").upsert(
    {
      organization_id: organizationId,
      sucursal_id: sucursalId,
      evolution_instance_name: instanceName,
      activo: true,
      ...statePayload(state, opts),
    },
    { onConflict: "sucursal_id" }
  )

  if (error) {
    console.error("upsertSucursalWhatsAppState: error actualizando sucursal_whatsapp_config", error)
  }
}

/**
 * Actualiza el estado de una fila EXISTENTE. Nunca crea filas: una fila con
 * instance_name implica que la instancia existe en Evolution, y esa garantía
 * solo la da el connect (createInstance). El poll de la UI usaba upsert y
 * creaba filas fantasma que el health check reportaba como perdidas.
 */
export async function updateSucursalWhatsAppState(
  organizationId: string,
  sucursalId: string,
  state: string,
  opts?: { qr?: boolean }
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("sucursal_whatsapp_config")
    .update(statePayload(state, opts))
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .select("sucursal_id")

  if (error) {
    console.error("updateSucursalWhatsAppState: error actualizando sucursal_whatsapp_config", error)
    return
  }

  // Sin fila no hay dónde guardar el estado: el connect nunca la creó (o su
  // upsert falló). El update en 0 filas no es error para PostgREST, así que
  // sin este log la sucursal quedaría degradada en silencio.
  if (!data || data.length === 0) {
    console.error(
      `updateSucursalWhatsAppState: no hay fila de config para la sucursal ${sucursalId}; el estado "${state}" no se guardó`
    )
  }
}
