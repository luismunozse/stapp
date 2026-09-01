import { describe, it, expect, vi, beforeEach } from 'vitest'

// Verifica que el camino de produccion (sendNotificationDirect) llega a Resend
// cuando RESEND_API_KEY esta configurada, y no a EnvialoSimple. La asercion es
// sobre la URL que golpea el fetch real del adaptador, no sobre un valor que
// se le paso a un mock: es la unica forma de probar que el ruteo de
// sendCustomer llega efectivamente a un proveedor distinto al de plataforma.
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
  cliente: { id: 'c1', nombre: 'Ana', email: 'ana@example.com', telefono: '+5491111' },
  orden: { id: 'o1', numeroOrden: 1, dispositivo: 'iPhone', estado: 'REPARADO' },
}

describe('sendNotificationDirect via Resend (kill switch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 're_test'
    process.env.RESEND_FROM = 'avisos@avisos.stapp.com.ar'
    wireSupabase({
      organizations: { notificaciones_email: true, notificaciones_whatsapp: false, plantillas_whatsapp: null, pais: 'AR' },
      clientes: { acepta_whatsapp: true },
      users: null,
    })
  })

  it('con RESEND_API_KEY seteada, el correo al cliente pega a la API de Resend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 're-999' }),
    }) as any

    const { sendNotificationDirect } = await import('../send-direct')
    await sendNotificationDirect({
      organizationId: 'org1',
      clienteId: 'c1',
      tipo: 'CAMBIO_ESTADO',
      context: baseContext as any,
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
  })
})
