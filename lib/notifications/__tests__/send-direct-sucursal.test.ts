import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendWhatsAppText = vi.fn().mockResolvedValue({ success: true, messageId: 'm', provider: 'evolution' })
vi.mock('@/lib/whatsapp/providers', () => ({ sendWhatsAppText: (...a: any[]) => sendWhatsAppText(...a) }))

const resolveWhatsAppSender = vi.fn()
vi.mock('@/lib/whatsapp/resolve-sender', () => ({
  resolveWhatsAppSender: (...a: any[]) => resolveWhatsAppSender(...a),
}))

// Silenciar el resto de canales; controlamos supabaseAdmin.from por tabla.
import { supabaseAdmin } from '@/lib/supabase'

function wireSupabase(overrides: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const row = overrides[table] ?? null
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    } as any
  })
}

const baseContext = {
  organizationName: 'Org',
  cliente: { id: 'c1', nombre: 'Ana', email: null, telefono: '+5491111' },
  orden: { id: 'o1', numeroOrden: 1, dispositivo: 'iPhone', estado: 'REPARADO' },
}

describe('sendNotificationDirect routing por sucursal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sucursal open -> manda con instanceNameOverride aunque el central no exista', async () => {
    resolveWhatsAppSender.mockResolvedValue({ scope: 'sucursal', instanceName: 'stapp-org-org1-suc-suc9' })
    wireSupabase({
      organizations: { notificaciones_email: false, notificaciones_whatsapp: true, plantillas_whatsapp: null, pais: 'AR' },
      clientes: { acepta_whatsapp: true },
      whatsapp_config: null, // central sin configurar
      users: null,
    })
    const { sendNotificationDirect } = await import('../send-direct')
    await sendNotificationDirect({
      organizationId: 'org1', sucursalId: 'suc9', clienteId: 'c1', tipo: 'CAMBIO_ESTADO', context: baseContext as any,
    })
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppText.mock.calls[0][3]).toEqual({ instanceNameOverride: 'stapp-org-org1-suc-suc9' })
  })

  it('sin sucursal conectada -> cae al central (sin override)', async () => {
    resolveWhatsAppSender.mockResolvedValue({ scope: 'central' })
    wireSupabase({
      organizations: { notificaciones_email: false, notificaciones_whatsapp: true, plantillas_whatsapp: null, pais: 'AR' },
      clientes: { acepta_whatsapp: true },
      whatsapp_config: { provider: 'evolution', is_configured: true, is_verified: true, evolution_connection_state: 'open' },
      users: null,
    })
    const { sendNotificationDirect } = await import('../send-direct')
    await sendNotificationDirect({
      organizationId: 'org1', sucursalId: 'suc9', clienteId: 'c1', tipo: 'CAMBIO_ESTADO', context: baseContext as any,
    })
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppText.mock.calls[0][3]).toBeUndefined()
  })
})
