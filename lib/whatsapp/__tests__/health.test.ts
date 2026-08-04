import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'

vi.mock('@/lib/whatsapp/platform-config', () => ({
  getPlatformEvolutionConfig: vi.fn(() => ({ baseUrl: 'https://evo.test', apiKey: 'k' })),
  buildInstanceName: (orgId: string) => `stapp-org-${orgId}`,
  buildSucursalInstanceName: (orgId: string, sucId: string) => `stapp-org-${orgId}-suc-${sucId}`,
}))

vi.mock('@/lib/whatsapp/providers/evolution', () => ({
  fetchInstances: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mail-1' }),
}))

import { runWhatsAppHealthCheck } from '../health'
import { fetchInstances } from '@/lib/whatsapp/providers/evolution'
import { sendEmail } from '@/lib/email'

const AHORA = new Date('2026-07-29T21:00:00.000Z')

/** Una instancia tal como la devuelve fetchInstances. */
function inst(
  name: string,
  state: 'open' | 'close' | 'connecting' | 'unknown',
  reason: number | null = null
) {
  return { name, state, disconnectionReasonCode: reason, updatedAt: '2026-07-29T20:00:00.000Z' }
}

/** Intentos de envío reales, la fuente que usa el detector de zombis. */
function fallos(organizationId: string, cantidad: number) {
  return Array.from({ length: cantidad }, () => ({ organization_id: organizationId, estado: 'FALLIDO' }))
}

/**
 * Mock de las tablas que toca el health check. Devuelve los espías de escritura
 * para poder afirmar sobre updates/inserts.
 */
function mockTablas(opts: {
  central?: any[]
  sucursales?: any[]
  saludPrevia?: any
  admins?: any[]
  logs?: any[]
}) {
  const updates: Record<string, any[]> = { whatsapp_config: [], sucursal_whatsapp_config: [] }
  const inserts: Record<string, any[]> = { user_notifications: [] }
  const upserts: Record<string, any[]> = { platform_health_state: [] }

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      update: vi.fn((payload: any) => {
        updates[table]?.push(payload)
        return chain
      }),
      insert: vi.fn((payload: any) => {
        inserts[table]?.push(payload)
        return Promise.resolve({ data: null, error: null })
      }),
      upsert: vi.fn((payload: any) => {
        upserts[table]?.push(payload)
        return Promise.resolve({ data: null, error: null })
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'platform_health_state' ? (opts.saludPrevia ?? null) : null,
        error: null,
      }),
    }

    const filas =
      table === 'whatsapp_config' ? (opts.central ?? [])
      : table === 'sucursal_whatsapp_config' ? (opts.sucursales ?? [])
      : table === 'users' ? (opts.admins ?? [{ id: 'admin-1', rol: 'ADMIN' }])
      : table === 'notification_logs' ? (opts.logs ?? [])
      : []

    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: filas, error: null, count: filas.length }).then(resolve, reject)

    return chain as any
  })

  return { updates, inserts, upserts }
}

const SUPERADMIN_EMAIL_ORIGINAL = process.env.SUPERADMIN_EMAIL

describe('runWhatsAppHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendEmail).mockResolvedValue({ id: 'mail-1' } as any)
    process.env.SUPERADMIN_EMAIL = 'super@stapp.test'
  })

  afterAll(() => {
    if (SUPERADMIN_EMAIL_ORIGINAL === undefined) delete process.env.SUPERADMIN_EMAIL
    else process.env.SUPERADMIN_EMAIL = SUPERADMIN_EMAIL_ORIGINAL
  })

  it('sin SUPERADMIN_EMAIL no intenta mandar la alerta', async () => {
    delete process.env.SUPERADMIN_EMAIL
    vi.mocked(fetchInstances).mockResolvedValue({ ok: false, instances: [], error: 'HTTP 502' })
    mockTablas({})

    const res = await runWhatsAppHealthCheck(AHORA)

    expect(res.platform).toBe('down')
    expect(res.alertaSuperadmin).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  describe('servidor Evolution caído', () => {
    // Este es el escenario del corte del 2026-07-28: si el cron marcara todas
    // las instancias como desconectadas, notificaría a 42 talleres algo que
    // ninguno puede arreglar y pisaría el último estado bueno conocido.
    it('no escribe estado de instancias ni notifica a los talleres', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: false, instances: [], error: 'HTTP 502' })
      const { updates, inserts } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.platform).toBe('down')
      
      expect(updates.whatsapp_config).toHaveLength(0)
      expect(inserts.user_notifications).toHaveLength(0)
    })

    it('alerta al superadmin por email la primera vez', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: false, instances: [], error: 'HTTP 502' })
      mockTablas({ saludPrevia: { service: 'evolution', state: 'up', last_alert_at: null } })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.alertaSuperadmin).toBe(true)
      expect(sendEmail).toHaveBeenCalledTimes(1)
      const arg = vi.mocked(sendEmail).mock.calls[0][0]
      expect(arg.subject).toContain('[ALERTA]')
      expect(arg.html).toContain('HTTP 502')
    })

    it('no repite la alerta si ya venía caído y se avisó hace poco', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: false, instances: [], error: 'HTTP 502' })
      mockTablas({
        saludPrevia: {
          service: 'evolution',
          state: 'down',
          last_alert_at: new Date(AHORA.getTime() - 30 * 60 * 1000).toISOString(),
        },
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.alertaSuperadmin).toBe(false)
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it('vuelve a alertar si sigue caído pero pasó la ventana de throttle', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: false, instances: [], error: 'timeout' })
      mockTablas({
        saludPrevia: {
          service: 'evolution',
          state: 'down',
          last_alert_at: new Date(AHORA.getTime() - 7 * 60 * 60 * 1000).toISOString(),
        },
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.alertaSuperadmin).toBe(true)
      expect(sendEmail).toHaveBeenCalledTimes(1)
    })
  })

  describe('servidor Evolution sano', () => {
    it('persiste el estado real y avisa al taller cuando una instancia pasa de open a close', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'close', 401)] })
      const { updates, inserts } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.platform).toBe('up')
      expect(updates.whatsapp_config[0]).toMatchObject({
        evolution_connection_state: 'close',
        is_verified: false,
      })
      expect(res.desconexionesNuevas).toBe(1)
      expect(inserts.user_notifications).toHaveLength(1)
      const notifs = inserts.user_notifications[0]
      expect(notifs[0]).toMatchObject({
        organization_id: 'org-1',
        type: 'WHATSAPP_DESCONECTADO',
        user_id: 'admin-1',
      })
    })

    it('no vuelve a notificar si ya estaba desconectada', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'close', 401)] })
      const { inserts } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'close' }],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.desconexionesNuevas).toBe(0)
      expect(inserts.user_notifications).toHaveLength(0)
    })

    it('no notifica cuando la instancia sigue conectada', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'open')] })
      const { updates, inserts } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.desconexionesNuevas).toBe(0)
      expect(inserts.user_notifications).toHaveLength(0)
      expect(updates.whatsapp_config[0]).toMatchObject({ evolution_connection_state: 'open', is_verified: true })
    })

    it('también refresca las instancias por sucursal', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1-suc', 'open')] })
      const { updates } = mockTablas({
        sucursales: [{
          organization_id: 'org-1',
          sucursal_id: 'suc-1',
          evolution_instance_name: 'i1-suc',
          evolution_connection_state: 'unknown',
        }],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.instanciasChequeadas).toBe(1)
      expect(updates.sucursal_whatsapp_config[0]).toMatchObject({ evolution_connection_state: 'open' })
    })

    // Mismo criterio que el probe de plataforma, a nivel instancia: si no
    // pudimos determinar el estado, preservar el último bueno conocido en vez de
    // degradarlo a "unknown" (que en send-direct.ts equivale a "no puede enviar").
    it('si no puede determinar el estado de una instancia, no pisa el estado guardado ni notifica', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [] })
      const { updates, inserts } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(updates.whatsapp_config).toHaveLength(0)
      expect(inserts.user_notifications).toHaveLength(0)
      expect(res.desconexionesNuevas).toBe(0)
      expect(res.indeterminadas).toBe(1)
    })

    it('una instancia indeterminada no impide chequear las demás', async () => {
      // i2 no viene en la respuesta del servidor; i1 sí.
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'close', 401)] })
      const { updates } = mockTablas({
        central: [
          { organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' },
          { organization_id: 'org-2', evolution_instance_name: 'i2', evolution_connection_state: 'open' },
        ],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.instanciasChequeadas).toBe(2)
      expect(res.indeterminadas).toBe(1)
      expect(updates.whatsapp_config).toHaveLength(1)
      expect(updates.whatsapp_config[0]).toMatchObject({ evolution_connection_state: 'close' })
    })
  })

  // El corte del 2026-07-28: Evolution reportaba `open` para 7 instancias cuyo
  // socket estaba muerto. connectionStatus NO prueba que se pueda enviar; los
  // únicos datos que no mienten son nuestros propios intentos de envío.
  describe('sesiones zombi (dice open pero no envía)', () => {
    it('detecta el zombi por los envíos fallados y avisa al taller', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'open')] })
      const { updates, inserts } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
        logs: fallos('org-1', 4),
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.zombisDetectados).toBe(1)
      expect(res.desconexionesNuevas).toBe(1)
      // Se persiste como close aunque el servidor jure que está open.
      expect(updates.whatsapp_config[0]).toMatchObject({
        evolution_connection_state: 'close',
        is_verified: false,
      })
      expect(inserts.user_notifications).toHaveLength(1)
    })

    it('no declara zombi con pocos intentos', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'open')] })
      const { updates } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
        logs: fallos('org-1', 2),
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.zombisDetectados).toBe(0)
      expect(updates.whatsapp_config[0]).toMatchObject({ evolution_connection_state: 'open' })
    })

    it('no declara zombi si hubo al menos un envío exitoso', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'open')] })
      const { updates } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
        logs: [...fallos('org-1', 5), { organization_id: 'org-1', estado: 'ENVIADO' }],
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.zombisDetectados).toBe(0)
      expect(updates.whatsapp_config[0]).toMatchObject({ evolution_connection_state: 'open' })
    })

    it('los fallos de otra org no ensucian a esta', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [inst('i1', 'open')] })
      const { updates } = mockTablas({
        central: [{ organization_id: 'org-1', evolution_instance_name: 'i1', evolution_connection_state: 'open' }],
        logs: fallos('org-9', 6),
      })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.zombisDetectados).toBe(0)
      expect(updates.whatsapp_config[0]).toMatchObject({ evolution_connection_state: 'open' })
    })

    it('registra la recuperación de la plataforma', async () => {
      vi.mocked(fetchInstances).mockResolvedValue({ ok: true, instances: [] })
      const { upserts } = mockTablas({ saludPrevia: { service: 'evolution', state: 'down', last_alert_at: null } })

      const res = await runWhatsAppHealthCheck(AHORA)

      expect(res.platform).toBe('up')
      expect(upserts.platform_health_state[0]).toMatchObject({ service: 'evolution', state: 'up' })
      // Avisar que volvió es útil: cierra el incidente sin tener que adivinar.
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toContain('recuperado')
    })
  })

  it('sin plataforma Evolution configurada no hace nada', async () => {
    const { getPlatformEvolutionConfig } = await import('@/lib/whatsapp/platform-config')
    vi.mocked(getPlatformEvolutionConfig).mockReturnValueOnce(null)
    mockTablas({})

    const res = await runWhatsAppHealthCheck(AHORA)

    expect(res.platform).toBe('unconfigured')
    expect(fetchInstances).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
