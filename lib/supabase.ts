import { createClient, SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

// Cliente para uso en el servidor (con service role key para bypass RLS cuando sea necesario)
// Usamos any para evitar problemas de tipos con las tablas que no están bien definidas
export const supabaseAdmin: SupabaseClient<any> = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// Cliente para uso general (respeta RLS)
export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Helper para crear cliente con token de usuario (para RLS basado en usuario)
export function createSupabaseClient(accessToken?: string) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
      },
    }
  )
}

// Storage buckets
export const STORAGE_BUCKETS = {
  FOTOS_ORDENES: "fotos-ordenes",
  LOGOS: "logos",
  FIRMAS: "firmas",
  CSV_IMPORTS: "csv-imports",
  APK_RELEASES: "apk-releases",
  SOPORTE_ATTACHMENTS: "soporte-attachments",
} as const

// Helper para obtener URL pública de un archivo
export function getPublicUrl(bucket: string, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
