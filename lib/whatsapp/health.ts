/**
 * Health check de las instancias de WhatsApp (Evolution).
 *
 * Por qué existe: `evolution_connection_state` en `whatsapp_config` y
 * `sucursal_whatsapp_config` es un snapshot cacheado que sólo se refrescaba
 * cuando un admin abría la pantalla de configuración. El 2026-07-28 el servidor
 * Evolution compartido se cayó ~23h y la base siguió diciendo "open" durante
 * semanas, así que los envíos automáticos degradaban en silencio (ver el
 * fallback a estado PENDIENTE en lib/notifications/send-direct.ts).
 *
 * Dos fallas distintas con dos dueños distintos:
 *  - servidor caído  -> lo resuelve la plataforma  -> email al superadmin
 *  - sesión caída    -> lo resuelve el taller      -> notificación in-app (reescanear QR)
 */

import { supabaseAdmin } from "@/lib/supabase"
import { sendEmail } from "@/lib/email"
import { getPlatformEvolutionConfig } from "@/lib/whatsapp/platform-config"
import { fetchInstances } from "@/lib/whatsapp/providers/evolution"

/** Servicio monitoreado en platform_health_state. */
const SERVICE = "evolution"

/** Mientras la plataforma siga caída, no repetir la alerta antes de esto. */
const THROTTLE_ALERTA_MS = 6 * 60 * 60 * 1000

/**
 * Ventana para detectar sesiones zombi: Evolution reporta `open` pero el socket
 * está muerto y todo envío falla. Pasó el 2026-07-28: 7 instancias quedaron en
 * `open` con el socket caído y la app siguió intentando enviar 23 horas.
 * `connectionStatus` NO alcanza como prueba de que se puede enviar.
 */
const VENTANA_ZOMBI_MS = 3 * 60 * 60 * 1000

/** Mínimo de intentos fallidos consecutivos para declarar una sesión zombi. */
const MIN_FALLOS_ZOMBI = 3

export interface HealthCheckResult {
  platform: "up" | "down" | "unconfigured"
  instanciasChequeadas: number
  desconexionesNuevas: number
  notificacionesTaller: number
  alertaSuperadmin: boolean
  /** Instancias cuyo estado no se pudo determinar: se preservó el guardado. */
  indeterminadas: number
  /** Instancias que Evolution reportó `open` pero cuyos envíos fallan en bloque. */
  zombisDetectados: number
  errores: number
}

interface FilaInstancia {
  tabla: "whatsapp_config" | "sucursal_whatsapp_config"
  organizationId: string
  sucursalId: string | null
  instanceName: string
  estadoPrevio: string | null
}

/**
 * Orgs cuyos envíos por WhatsApp vienen fallando en bloque: prueba de que la
 * sesión no sirve, sin importar lo que reporte Evolution. Es la única fuente que
 * no puede mentir, porque son nuestros propios intentos reales.
 *
 * Sólo se aplica a la instancia central: `notification_logs` no guarda
 * `sucursal_id`, así que no se puede atribuir un fallo a una sucursal puntual.
 */
async function orgsConEnviosFallando(ahora: Date): Promise<Set<string>> {
  const desde = new Date(ahora.getTime() - VENTANA_ZOMBI_MS).toISOString()

  const { data } = await supabaseAdmin
    .from("notification_logs")
    .select("organization_id, estado")
    .eq("canal", "WHATSAPP")
    .in("estado", ["ENVIADO", "FALLIDO"])
    .gte("created_at", desde)

  const conteo = new Map<string, { total: number; fallidos: number }>()
  for (const l of data ?? []) {
    const c = conteo.get(l.organization_id) ?? { total: 0, fallidos: 0 }
    c.total++
    if (l.estado === "FALLIDO") c.fallidos++
    conteo.set(l.organization_id, c)
  }

  const zombis = new Set<string>()
  for (const [orgId, c] of conteo) {
    if (c.total >= MIN_FALLOS_ZOMBI && c.fallidos === c.total) zombis.add(orgId)
  }
  return zombis
}

async function cargarInstancias(): Promise<FilaInstancia[]> {
  const { data: central } = await supabaseAdmin
    .from("whatsapp_config")
    .select("organization_id, evolution_instance_name, evolution_connection_state")
    .not("evolution_instance_name", "is", null)

  const { data: sucursales } = await supabaseAdmin
    .from("sucursal_whatsapp_config")
    .select("organization_id, sucursal_id, evolution_instance_name, evolution_connection_state")
    .not("evolution_instance_name", "is", null)

  const filas: FilaInstancia[] = []

  for (const c of central ?? []) {
    filas.push({
      tabla: "whatsapp_config",
      organizationId: c.organization_id,
      sucursalId: null,
      instanceName: c.evolution_instance_name,
      estadoPrevio: c.evolution_connection_state,
    })
  }

  for (const s of sucursales ?? []) {
    filas.push({
      tabla: "sucursal_whatsapp_config",
      organizationId: s.organization_id,
      sucursalId: s.sucursal_id,
      instanceName: s.evolution_instance_name,
      estadoPrevio: s.evolution_connection_state,
    })
  }

  return filas
}

/** Notifica a los ADMIN de la org que su WhatsApp dejó de funcionar. */
async function notificarTaller(fila: FilaInstancia, motivo: "logout" | "caida"): Promise<number> {
  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, rol")
    .eq("organization_id", fila.organizationId)
    .eq("rol", "ADMIN")

  const admins = users ?? []
  if (admins.length === 0) return 0

  const alcance = fila.sucursalId ? "de la sucursal" : "del negocio"
  const body =
    motivo === "logout"
      ? `Se cerró la sesión de WhatsApp ${alcance} y los mensajes automáticos no se están enviando. Volvé a escanear el código QR desde Configuración.`
      : `El WhatsApp ${alcance} dejó de enviar mensajes. Entrá a Configuración y volvé a escanear el código QR.`

  await supabaseAdmin.from("user_notifications").insert(
    admins.map((u) => ({
      organization_id: fila.organizationId,
      user_id: u.id,
      title: "WhatsApp desconectado",
      body,
      type: "WHATSAPP_DESCONECTADO",
      icon: "message-circle-off",
      action_url: "/configuracion",
    }))
  )

  return admins.length
}

async function alertarSuperadmin(asunto: string, cuerpo: string): Promise<boolean> {
  const destino = process.env.SUPERADMIN_EMAIL
  if (!destino) {
    console.error("whatsapp-health: SUPERADMIN_EMAIL no configurado, no se pudo alertar")
    return false
  }

  try {
    await sendEmail({
      to: destino,
      subject: asunto,
      html: cuerpo,
      fromName: "STApp Monitoreo",
    })
    return true
  } catch (err) {
    console.error("whatsapp-health: fallo el envio de la alerta al superadmin", err)
    return false
  }
}

async function guardarSalud(
  state: "up" | "down",
  ahora: Date,
  opts: { previo: { state?: string; changed_at?: string } | null; error?: string; alertado: boolean; lastAlertAt?: string | null }
) {
  const cambio = opts.previo?.state !== state
  await supabaseAdmin.from("platform_health_state").upsert(
    {
      service: SERVICE,
      state,
      last_error: opts.error ?? null,
      checked_at: ahora.toISOString(),
      changed_at: cambio ? ahora.toISOString() : (opts.previo?.changed_at ?? ahora.toISOString()),
      last_alert_at: opts.alertado ? ahora.toISOString() : (opts.lastAlertAt ?? null),
    },
    { onConflict: "service" }
  )
}

/**
 * Refresca el estado real de todas las instancias y alerta a quien corresponda.
 * `ahora` se inyecta para que los tests sean deterministas.
 */
export async function runWhatsAppHealthCheck(ahora: Date = new Date()): Promise<HealthCheckResult> {
  const base: HealthCheckResult = {
    platform: "unconfigured",
    instanciasChequeadas: 0,
    desconexionesNuevas: 0,
    notificacionesTaller: 0,
    alertaSuperadmin: false,
    indeterminadas: 0,
    zombisDetectados: 0,
    errores: 0,
  }

  const platform = getPlatformEvolutionConfig()
  if (!platform) return base

  const { data: previo } = await supabaseAdmin
    .from("platform_health_state")
    .select("service, state, changed_at, last_alert_at")
    .eq("service", SERVICE)
    .maybeSingle()

  const lastAlertAt = (previo as { last_alert_at?: string | null } | null)?.last_alert_at ?? null

  // ── Paso 1: probe de plataforma + estados, en UNA llamada ──
  const ping = await fetchInstances(platform)

  if (!ping.ok) {
    // Servidor caído: NO tocar el estado de las instancias. Si las marcáramos
    // desconectadas perderíamos el último estado bueno y notificaríamos a todos
    // los talleres un problema que ninguno puede resolver.
    const veniaCaido = previo?.state === "down"
    const desdeUltimaAlerta = lastAlertAt ? ahora.getTime() - new Date(lastAlertAt).getTime() : Infinity
    const debeAlertar = !veniaCaido || desdeUltimaAlerta >= THROTTLE_ALERTA_MS

    let alertado = false
    if (debeAlertar) {
      alertado = await alertarSuperadmin(
        "[ALERTA] Servidor de WhatsApp (Evolution) no responde",
        `<p>El servidor Evolution compartido no responde. Mientras siga así, <strong>ningún mensaje automático de WhatsApp sale</strong> para ningún taller.</p>
         <p><strong>Error:</strong> ${ping.error ?? "desconocido"}</p>
         <p><strong>Detectado:</strong> ${ahora.toISOString()}</p>
         <p>El estado de las instancias no se modificó a propósito, para no perder el último estado bueno conocido.</p>`
      )
    }

    await guardarSalud("down", ahora, { previo: previo ?? null, error: ping.error, alertado, lastAlertAt })

    return { ...base, platform: "down", alertaSuperadmin: alertado }
  }

  // ── Paso 2: cruzar los estados reportados con nuestros envíos reales ──
  const filas = await cargarInstancias()
  const porNombre = new Map(ping.instances.map((i) => [i.name, i]))
  const zombis = await orgsConEnviosFallando(ahora)

  let desconexionesNuevas = 0
  let notificacionesTaller = 0
  let indeterminadas = 0
  let zombisDetectados = 0
  let errores = 0

  for (const fila of filas) {
    try {
      const info = porNombre.get(fila.instanceName)

      // La instancia existe en nuestra base pero el servidor no la lista: no
      // sabemos su estado, así que preservamos el último bueno conocido en vez
      // de degradarlo (escribir "unknown" la marca incapaz de enviar, ver
      // resolve-sender.ts).
      if (!info) {
        console.error(`whatsapp-health: ${fila.instanceName} no aparece en fetchInstances`)
        indeterminadas++
        continue
      }

      // Sesión zombi: Evolution dice `open` pero nuestros envíos fallan en
      // bloque. Le creemos a nuestros intentos, no al status. Sólo para la
      // instancia central: notification_logs no guarda sucursal_id.
      const esZombi =
        info.state === "open" && fila.tabla === "whatsapp_config" && zombis.has(fila.organizationId)
      if (esZombi) zombisDetectados++

      const estadoEfectivo = esZombi ? "close" : info.state
      const usable = estadoEfectivo === "open"

      await supabaseAdmin
        .from(fila.tabla)
        .update({
          evolution_connection_state: estadoEfectivo,
          ...(fila.tabla === "whatsapp_config" ? { is_verified: usable } : {}),
        })
        .eq("organization_id", fila.organizationId)
        .eq("evolution_instance_name", fila.instanceName)

      // ── Paso 3: alertar al taller sólo en la TRANSICIÓN a inutilizable ──
      // Sin este chequeo, un taller desconectado una semana juntaría 168
      // notificaciones idénticas.
      if (fila.estadoPrevio === "open" && !usable) {
        desconexionesNuevas++
        // 401 = el teléfono cerró la sesión; el mensaje al taller lo distingue.
        const motivo = info.disconnectionReasonCode === 401 ? "logout" : "caida"
        notificacionesTaller += await notificarTaller(fila, motivo)
      }
    } catch (err) {
      console.error(`whatsapp-health: fallo la instancia ${fila.instanceName}`, err)
      errores++
    }
  }

  // Si venía caído, avisar que volvió: cierra el incidente sin adivinar.
  let alertado = false
  if (previo?.state === "down") {
    alertado = await alertarSuperadmin(
      "[OK] Servidor de WhatsApp (Evolution) recuperado",
      `<p>El servidor Evolution volvió a responder.</p>
       <p><strong>Instancias chequeadas:</strong> ${filas.length}</p>
       <p><strong>Desconectadas desde el último chequeo:</strong> ${desconexionesNuevas}</p>
       <p>Los talleres cuya sesión quedó caída fueron notificados para reescanear el QR.</p>`
    )
  }

  await guardarSalud("up", ahora, { previo: previo ?? null, alertado, lastAlertAt })

  return {
    platform: "up",
    instanciasChequeadas: filas.length,
    desconexionesNuevas,
    notificacionesTaller,
    alertaSuperadmin: alertado,
    indeterminadas,
    zombisDetectados,
    errores,
  }
}
