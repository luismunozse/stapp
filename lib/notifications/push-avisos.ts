import { supabaseAdmin } from "@/lib/supabase"
import { sendPushToUsers, type PushPayload } from "@/lib/push/send"

/**
 * Barrido de avisos -> push (outbox sobre user_notifications).
 *
 * Todo aviso de la campanita tiene que llegar también como push, lo haya
 * escrito quien lo haya escrito (código Node o el trigger SQL de stock bajo).
 * El cron /api/cron/avisos-push llama a esta función cada minuto; el RPC
 * claim_avisos_para_push (migración 372) marca y devuelve de forma atómica las
 * filas pendientes de usuarios con suscripción, así dos corridas nunca
 * duplican un envío.
 */

const LIMITE_POR_CORRIDA = 500
/** Usuarios procesados a la vez dentro de cada envío (cada uno hace 2 selects + N envíos). */
const CONCURRENCIA_USUARIOS = 10

interface AvisoReclamado {
  id: string
  user_id: string
  title: string
  body: string
  action_url: string | null
  orden_id: string | null
  type: string
}

export interface ResumenPushAvisos {
  claimed: number
  usuarios: number
  enviados: number
  fallidos: number
  /** Presente solo si el RPC falló: nada se reclamó ni se mandó. */
  error?: string
}

/**
 * Los avisos con el mismo contenido visible se mandan en una sola llamada
 * (un broadcast son miles de filas idénticas, una por usuario).
 */
function claveDeGrupo(a: AvisoReclamado): string {
  return JSON.stringify([a.title, a.body, a.action_url, a.orden_id, a.type])
}

function armarPayload(grupo: AvisoReclamado[]): PushPayload {
  const primero = grupo[0]
  // Con una sola fila el id identifica el aviso. Con varias (broadcast) cada
  // usuario tiene el suyo y no hay un id único que mandar: se omite.
  const avisoId = grupo.length === 1 ? { avisoId: primero.id } : {}
  return {
    title: primero.title,
    body: primero.body,
    // aviso.icon es un nombre de ícono lucide, no una URL: no se mapea a `icon`.
    ...(primero.action_url ? { path: primero.action_url } : {}),
    tag: primero.orden_id ? `orden-${primero.orden_id}` : `aviso-${primero.id}`,
    data: { ...avisoId, type: primero.type },
  }
}

export async function enviarPushDeAvisos(): Promise<ResumenPushAvisos> {
  const resumen: ResumenPushAvisos = { claimed: 0, usuarios: 0, enviados: 0, fallidos: 0 }

  const { data, error } = await supabaseAdmin.rpc("claim_avisos_para_push", {
    p_limit: LIMITE_POR_CORRIDA,
  })
  if (error) {
    console.error("enviarPushDeAvisos: no se pudo reclamar avisos", error.message)
    return { ...resumen, error: error.message }
  }

  const filas = (data ?? []) as AvisoReclamado[]
  resumen.claimed = filas.length
  if (filas.length === 0) return resumen

  const grupos = new Map<string, AvisoReclamado[]>()
  for (const fila of filas) {
    const clave = claveDeGrupo(fila)
    const grupo = grupos.get(clave)
    if (grupo) grupo.push(fila)
    else grupos.set(clave, [fila])
  }

  const usuarios = new Set<string>()
  for (const grupo of grupos.values()) {
    const userIds = Array.from(new Set(grupo.map((a) => a.user_id)))
    userIds.forEach((id) => usuarios.add(id))
    try {
      const r = await sendPushToUsers(userIds, armarPayload(grupo), {
        concurrency: CONCURRENCIA_USUARIOS,
      })
      resumen.enviados += r.sent
      resumen.fallidos += r.failed
    } catch (e) {
      // Un grupo roto no puede tumbar a los demás: ya están marcados como reclamados.
      console.error("enviarPushDeAvisos: grupo falló", e)
      resumen.fallidos += userIds.length
    }
  }
  resumen.usuarios = usuarios.size

  return resumen
}
