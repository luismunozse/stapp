import { createClient, SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

// Lazy-initialized clients para evitar crash durante build (cuando env vars no están disponibles)

let _supabaseAdmin: SupabaseClient<any> | null = null
let _supabase: SupabaseClient<Database> | null = null

// Cliente para uso en el servidor (con service role key para bypass RLS cuando sea necesario)
export function getSupabaseAdmin(): SupabaseClient<any> {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )
  }
  return _supabaseAdmin
}

// Cliente para uso general (respeta RLS)
function getSupabase(): SupabaseClient<Database> {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _supabase
}

// Mantener exports como getters para compatibilidad con código existente
export const supabaseAdmin: SupabaseClient<any> = new Proxy({} as SupabaseClient<any>, {
  get(_target, prop) {
    return (getSupabaseAdmin() as any)[prop]
  },
})

export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    return (getSupabase() as any)[prop]
  },
})

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
  FOTOS_INVENTARIO: "fotos-inventario",
  LOGOS: "logos",
  FIRMAS: "firmas",
  CSV_IMPORTS: "csv-imports",
  APK_RELEASES: "apk-releases",
  SOPORTE_ATTACHMENTS: "soporte-attachments",
  AVATARS: "avatars",
  COMPROBANTES_GASTOS: "comprobantes-gastos",
} as const

// Helper para obtener URL pública de un archivo
export function getPublicUrl(bucket: string, path: string): string {
  const { data } = getSupabase().storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
