import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { getSucursalWhatsAppConfig, upsertSucursalWhatsAppState } from '../sucursal-config'

function mockConfigRow(row: any) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
}

describe('getSucursalWhatsAppConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('devuelve la fila cuando existe config para la sucursal', async () => {
    mockConfigRow({
      evolution_instance_name: 'stapp-org-org1-suc-suc9',
      evolution_connection_state: 'open',
      activo: true,
    })
    const result = await getSucursalWhatsAppConfig('org1', 'suc9')
    expect(supabaseAdmin.from).toHaveBeenCalledWith('sucursal_whatsapp_config')
    expect(result).toEqual({
      evolution_instance_name: 'stapp-org-org1-suc-suc9',
      evolution_connection_state: 'open',
      activo: true,
    })
  })

  it('devuelve null cuando no hay fila de config', async () => {
    mockConfigRow(null)
    const result = await getSucursalWhatsAppConfig('org1', 'suc9')
    expect(result).toBeNull()
  })
})

describe('upsertSucursalWhatsAppState', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hace upsert con onConflict sucursal_id', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue({ upsert } as any)
    await upsertSucursalWhatsAppState('org1', 'suc9', 'stapp-org-org1-suc-suc9', 'open', { qr: true })
    expect(supabaseAdmin.from).toHaveBeenCalledWith('sucursal_whatsapp_config')
    const [row, opts] = upsert.mock.calls[0]
    expect(row.organization_id).toBe('org1')
    expect(row.sucursal_id).toBe('suc9')
    expect(row.evolution_instance_name).toBe('stapp-org-org1-suc-suc9')
    expect(row.evolution_connection_state).toBe('open')
    expect(row.activo).toBe(true)
    expect(row.evolution_last_qr_at).toBeTruthy()
    expect(opts).toEqual({ onConflict: 'sucursal_id' })
  })

  it('sin opts.qr no incluye evolution_last_qr_at', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue({ upsert } as any)
    await upsertSucursalWhatsAppState('org1', 'suc9', 'stapp-org-org1-suc-suc9', 'connecting')
    const [row] = upsert.mock.calls[0]
    expect('evolution_last_qr_at' in row).toBe(false)
  })
})
