import { describe, it, expect, vi, beforeEach } from 'vitest'

// Verifica que el camino de produccion (sendNotificationDirect) llega a Resend
// cuando RESEND_API_KEY esta configurada, y no a EnvialoSimple. La asercion es
// sobre la URL que golpea el fetch real del adaptador, no sobre un valor que
// se le paso a un mock: es la unica forma de probar que el ruteo de
// sendCustomer llega efectivamente a un proveedor distinto al de plataforma.
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
      // sendCustomer consulta email_suprimidos (ilike + maybeSingle) antes de
      // elegir proveedor. Sin overrides para esa tabla, row queda en null: la
      // direccion no esta suprimida y el envio sigue por el camino normal.
      ilike: vi.fn().mockReturnThis(),
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

  it('con RESEND_API_KEY seteada y Resend respondiendo no-ok, el log FALLIDO atribuye el intento a resend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    }) as any

    const inserts: Array<{ table: string; payload: any }> = []
    wireSupabase(
      {
        organizations: { notificaciones_email: true, notificaciones_whatsapp: false, plantillas_whatsapp: null, pais: 'AR' },
        clientes: { acepta_whatsapp: true },
        users: null,
      },
      (table, payload) => inserts.push({ table, payload })
    )

    const { sendNotificationDirect } = await import('../send-direct')
    await sendNotificationDirect({
      organizationId: 'org1',
      clienteId: 'c1',
      tipo: 'CAMBIO_ESTADO',
      context: baseContext as any,
    })

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
    // El intento fallido fue por Resend (RESEND_API_KEY estaba seteada): el
    // log NO debe atribuirlo a EnvialoSimple, que es el default de la columna
    // y lo que se registraba antes de este fix.
    expect(logInsert!.payload.proveedor).toBe('resend')
  })
})
