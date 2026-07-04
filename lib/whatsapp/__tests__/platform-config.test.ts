import { describe, it, expect } from 'vitest'
import { buildSucursalInstanceName } from '../platform-config'

describe('buildSucursalInstanceName', () => {
  it('compone instancia por org y sucursal', () => {
    expect(buildSucursalInstanceName('org1', 'suc9')).toBe('stapp-org-org1-suc-suc9')
  })
})
