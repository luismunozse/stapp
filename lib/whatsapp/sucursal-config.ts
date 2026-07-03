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
  const { data } = await supabaseAdmin
    .from("sucursal_whatsapp_config")
    .select("evolution_instance_name, evolution_connection_state, activo")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle()
  return (data as SucursalWhatsAppRow | null) ?? null
}

export async function upsertSucursalWhatsAppState(
  organizationId: string,
  sucursalId: string,
  instanceName: string,
  state: string,
  opts?: { qr?: boolean }
): Promise<void> {
  await supabaseAdmin.from("sucursal_whatsapp_config").upsert(
    {
      organization_id: organizationId,
      sucursal_id: sucursalId,
      evolution_instance_name: instanceName,
      evolution_connection_state: state,
      activo: true,
      ...(opts?.qr ? { evolution_last_qr_at: new Date().toISOString() } : {}),
    },
    { onConflict: "sucursal_id" }
  )
}
