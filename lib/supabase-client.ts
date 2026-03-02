"use client"

import { createClient } from "@supabase/supabase-js"

// Cliente Supabase para uso client-side (realtime, storage público)
// Usa la anon key que respeta RLS
let clientInstance: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (clientInstance) return clientInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables")
  }

  clientInstance = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  })

  return clientInstance
}
