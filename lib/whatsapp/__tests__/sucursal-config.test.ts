import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { upsertSucursalWhatsAppState } from '../sucursal-config'

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
    expect(row.evolution_last_qr_at).toBeTruthy()
    expect(opts).toEqual({ onConflict: 'sucursal_id' })
  })
})
