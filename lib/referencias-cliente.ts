import { supabaseAdmin } from "@/lib/supabase"

/**
 * Valida que un cliente (y opcionalmente uno de sus sectores) pertenezca a la
 * organización antes de referenciarlo desde un documento nuevo.
 *
 * Las rutas escriben con service_role (sin RLS), así que un id ajeno llegaría
 * intacto a la FK y el documento quedaría colgado de datos de otro taller.
 *
 * Devuelve el mensaje de error para responder 400, o null si todo es válido.
 */
export async function validarClienteYSector(
  organizationId: string,
  clienteId: string,
  sectorId?: string | null
): Promise<string | null> {
  const { data: cliente, error } = await supabaseAdmin
    .from("clientes")
    .select("id")
    .eq("id", clienteId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (error) throw error
  if (!cliente) return "Cliente no encontrado"

  if (sectorId) {
    // sectores_cliente no tiene organization_id: la pertenencia se hereda del
    // cliente, que ya se validó arriba.
    const { data: sector, error: sectorError } = await supabaseAdmin
      .from("sectores_cliente")
      .select("id")
      .eq("id", sectorId)
      .eq("cliente_id", clienteId)
      .maybeSingle()
    if (sectorError) throw sectorError
    if (!sector) return "Sector no válido para este cliente"
  }

  return null
}
