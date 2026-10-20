import { supabaseAdmin } from "@/lib/supabase"
import { sendPushToUser, type PushPayload, type SendResult } from "@/lib/push/send"

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
/**
 * Envíos en vuelo a la vez, sumando TODOS los usuarios de la corrida. Las filas
 * ya están marcadas al reclamarlas: si la corrida no termina antes del
 * maxDuration de la ruta, esos pushes se pierden.
 */
const CONCURRENCIA_ENVIOS = 10

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
  /** Todos los envíos con destino se saltearon porque VAPID/FCM no está configurado. */
  sinConfiguracion?: true
}

interface Envio {
  userId: string
  payload: PushPayload
}

function armarPayload(a: AvisoReclamado): PushPayload {
  return {
    title: a.title,
    body: a.body,
    // aviso.icon es un nombre de ícono lucide, no una URL: no se mapea a `icon`.
    ...(a.action_url ? { path: a.action_url } : {}),
    tag: a.orden_id ? `orden-${a.orden_id}` : `aviso-${a.id}`,
    data: { avisoId: a.id, type: a.type },
  }
}

/** Un envío por (usuario, contenido visible): filas idénticas del mismo usuario salen una sola vez. */
function armarEnvios(filas: AvisoReclamado[]): Envio[] {
  const vistos = new Set<string>()
  const envios: Envio[] = []
  for (const a of filas) {
    const clave = JSON.stringify([a.user_id, a.title, a.body, a.action_url, a.orden_id, a.type])
    if (vistos.has(clave)) continue
    vistos.add(clave)
    envios.push({ userId: a.user_id, payload: armarPayload(a) })
  }
  return envios
}

const esSinConfigurar = (r: SendResult) =>
  r.sent === 0 && r.skipped > 0 && r.errors.some((e) => e.includes("no configurado"))

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

  const envios = armarEnvios(filas)
  resumen.usuarios = new Set(envios.map((e) => e.userId)).size

  // Un único pool para toda la corrida; un envío roto no puede tumbar a los demás.
  let siguiente = 0
  let conDestino = 0
  let sinConfigurar = 0
  const worker = async () => {
    while (siguiente < envios.length) {
      const { userId, payload } = envios[siguiente++]
      try {
        const r = await sendPushToUser(userId, payload)
        resumen.enviados += r.sent
        resumen.fallidos += r.failed
        if (r.sent + r.failed + r.skipped > 0) conDestino++
        if (esSinConfigurar(r)) sinConfigurar++
      } catch (e) {
        console.error("enviarPushDeAvisos: envío falló", userId, e)
        resumen.fallidos++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_ENVIOS, envios.length) }, worker))

  if (conDestino > 0 && sinConfigurar === conDestino) {
    console.error(
      "enviarPushDeAvisos: push sin configurar (VAPID_*/FCM_SERVICE_ACCOUNT o paquete faltante); los avisos reclamados NO salieron"
    )
    resumen.sinConfiguracion = true
  }

  return resumen
}
