import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveWhatsAppSender } from '../resolve-sender'

function mockConfigRow(row: any) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
}

describe('resolveWhatsAppSender', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sucursalId -> central (no consulta)', async () => {
    const r = await resolveWhatsAppSender('org1', null)
    expect(r).toEqual({ scope: 'central' })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('sucursal open + activo -> usa la instancia de la sucursal', async () => {
    mockConfigRow({ activo: true, evolution_connection_state: 'open', evolution_instance_name: 'stapp-org-org1-suc-suc9' })
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'sucursal', instanceName: 'stapp-org-org1-suc-suc9' })
  })

  it('sucursal desconectada -> central', async () => {
    mockConfigRow({ activo: true, evolution_connection_state: 'close', evolution_instance_name: 'x' })
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'central' })
  })

  it('sucursal inactiva -> central', async () => {
    mockConfigRow({ activo: false, evolution_connection_state: 'open', evolution_instance_name: 'x' })
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'central' })
  })

  it('sin fila de config -> central', async () => {
    mockConfigRow(null)
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'central' })
  })
})
