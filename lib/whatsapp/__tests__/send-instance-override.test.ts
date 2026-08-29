import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'

vi.mock('@/lib/whatsapp/platform-config', () => ({
  getPlatformEvolutionConfig: () => ({ baseUrl: 'https://evo.test', apiKey: 'k' }),
  buildInstanceName: (o: string) => `stapp-org-${o}`,
  buildSucursalInstanceName: (o: string, s: string) => `stapp-org-${o}-suc-${s}`,
}))

const evoSendText = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' })
vi.mock('@/lib/whatsapp/providers/evolution', () => ({
  sendText: (...args: any[]) => evoSendText(...args),
}))

describe('sendWhatsAppText con instanceNameOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // loadOrgCountry consulta "organizations"; el mock global de @/lib/supabase
    // no resuelve single() por defecto, así que le damos una respuesta vacía
    // para ejercitar el código real sin pegarle a una DB.
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any)
  })

  // El numero va completo a proposito: sendWhatsAppText descarta los destinos
  // a los que les falta el codigo de area antes de llegar al proveedor.
  it('usa la instancia override sin leer whatsapp_config', async () => {
    const { sendWhatsAppText } = await import('../providers')
    const res = await sendWhatsAppText('org1', '+5491160351282', 'hola', {
      instanceNameOverride: 'stapp-org-org1-suc-suc9',
    })
    expect(res.success).toBe(true)
    expect(res.provider).toBe('evolution')
    // primer arg de evoSendText son las creds con la instancia override
    expect(evoSendText.mock.calls[0][0].instanceName).toBe('stapp-org-org1-suc-suc9')
  })
})
