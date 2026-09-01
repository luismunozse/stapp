import { describe, it, expect, vi, beforeEach } from 'vitest'

// Cubre el mismo agujero que send-direct-resend.test.ts pero en el otro
// consumidor de sendCustomer: NotificationService.sendEmail. Antes del fix,
// el catch de sendEmail no pasaba `proveedor` a logNotification, que caia al
// default 'envialosimple' aunque el intento fallido hubiese sido por Resend.
import { supabaseAdmin } from '@/lib/supabase'

function wireSupabase(overrides: Record<string, any>, insertSpy?: (table: string, payload: any) => void) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const row = overrides[table] ?? null
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockImplementation((payload: any) => {
        insertSpy?.(table, payload)
        return Promise.resolve({ data: null, error: null })
      }),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    } as any
  })
}

const baseContext = {
  organizationId: 'org1',
  organizationName: 'Org',
  cliente: { id: 'c1', nombre: 'Ana', email: 'ana@example.com', telefono: '+5491111' },
  orden: { id: 'o1', numeroOrden: 1, dispositivo: 'iPhone', estado: 'REPARADO' },
}

describe('NotificationService.sendNotification via Resend (kill switch, path de falla)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 're_test'
    process.env.RESEND_FROM = 'avisos@avisos.stapp.com.ar'
  })

  it('con RESEND_API_KEY seteada y Resend respondiendo no-ok, el log FALLIDO atribuye el intento a resend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    }) as any

    const inserts: Array<{ table: string; payload: any }> = []
    wireSupabase(
      {
        organizations: { notificaciones_email: true, notificaciones_whatsapp: false, dias_recordatorio: 3, pais: 'AR' },
      },
      (table, payload) => inserts.push({ table, payload })
    )

    const { NotificationService } = await import('../index')
    const service = new NotificationService('org1')
    await service.sendNotification('CAMBIO_ESTADO', baseContext as any, ['EMAIL'])

    const logInsert = inserts.find((i) => i.table === 'notification_logs')
    expect(logInsert).toBeDefined()
    expect(logInsert!.payload.estado).toBe('FALLIDO')
    expect(logInsert!.payload.proveedor).toBe('resend')
  })
})
