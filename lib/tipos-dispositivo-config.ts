import { supabaseAdmin } from "@/lib/supabase"
import { TIPOS_BASE_CONFIG } from "@/lib/tipos-dispositivo-defaults"

/** Does this device type (for the given org) require IMEI validation (exactly 15 digits)? */
export async function tipoValidaImei(organizationId: string, tipoCodigo: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("tipos_dispositivo")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("codigo", tipoCodigo)
    .maybeSingle()

  const config = (data?.config as any) ?? (TIPOS_BASE_CONFIG as any)[tipoCodigo] ?? null
  return config?.campos?.imei?.validacion === "imei"
}