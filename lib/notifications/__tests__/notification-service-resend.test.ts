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
      // sendCustomer consulta email_suprimidos (eq + maybeSingle) antes de
      // elegir proveedor. Sin overrides para esa tabla, row queda en null: la
      // direccion no esta suprimida y el envio sigue por el camino normal.
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

    // proveedorCliente() re-lee RESEND_API_KEY de forma independiente al
    // fetch real de sendCustomer: si alguien revirtiera sendCustomer a pegarle
    // siempre a EnvialoSimple, esta aserción por si sola seguiría en verde.
    // La URL real que golpeó el fetch es la única prueba de que el intento
    // fallido efectivamente paso por Resend.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')

    const logInsert = inserts.find((i) => i.table === 'notification_logs')
    expect(logInsert).toBeDefined()
    expect(logInsert!.payload.estado).toBe('FALLIDO')
    expect(logInsert!.payload.proveedor).toBe('resend')
  })

  async function enviarYLeerBody(orgRow: Record<string, any>) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend-1' }),
    }) as any
    wireSupabase({ organizations: orgRow })

    const { NotificationService } = await import('../index')
    const service = new NotificationService('org1')
    await service.sendNotification('CAMBIO_ESTADO', baseContext as any, ['EMAIL'])

    expect(global.fetch).toHaveBeenCalledTimes(1)
    return JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
  }

  it('manda el nombre del taller como remitente y su email como reply_to', async () => {
    const body = await enviarYLeerBody({
      notificaciones_email: true,
      notificaciones_whatsapp: false,
      dias_recordatorio: 3,
      pais: 'AR',
      email: 'taller@example.com',
    })

    expect(body.from).toBe('Org <avisos@avisos.stapp.com.ar>')
    expect(body.reply_to).toBe('taller@example.com')
  })

  it('sin email del taller no manda reply_to pero igual manda el nombre', async () => {
    const body = await enviarYLeerBody({
      notificaciones_email: true,
      notificaciones_whatsapp: false,
      dias_recordatorio: 3,
      pais: 'AR',
      email: null,
    })

    expect(body.from).toBe('Org <avisos@avisos.stapp.com.ar>')
    expect(body).not.toHaveProperty('reply_to')
  })

  it('descarta un email del taller con formato invalido', async () => {
    const body = await enviarYLeerBody({
      notificaciones_email: true,
      notificaciones_whatsapp: false,
      dias_recordatorio: 3,
      pais: 'AR',
      email: 'no es un correo',
    })

    expect(body).not.toHaveProperty('reply_to')
  })
})
