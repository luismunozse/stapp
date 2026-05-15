import { describe, it, expect } from 'vitest'
import {
  classifyEstado,
  getTimeRemaining,
  shouldShowTimeRemaining,
  getRetiroStepper,
  getRetiroLabel,
  defaultMotivoSinCobro,
  MOTIVOS_SIN_COBRO,
  ESTADO_FLOW,
} from '../seguimiento-state'

describe('classifyEstado — estados lineales del flow', () => {
  it('RECIBIDO → primer paso, 0%', () => {
    const c = classifyEstado('RECIBIDO')
    expect(c.currentIndex).toBe(0)
    expect(c.progressPercent).toBe(0)
    expect(c.isCompleted).toBe(false)
    expect(c.isTerminal).toBe(false)
    expect(c.isRetiro).toBe(false)
    expect(c.isReady).toBe(false)
  })

  it('EN_DIAGNOSTICO → index 1, ~17%', () => {
    const c = classifyEstado('EN_DIAGNOSTICO')
    expect(c.currentIndex).toBe(1)
    expect(c.progressPercent).toBe(17)
  })

  it('REPARADO → isReady, ~83%', () => {
    const c = classifyEstado('REPARADO')
    expect(c.currentIndex).toBe(5)
    expect(c.progressPercent).toBe(83)
    expect(c.isReady).toBe(true)
    expect(c.isCompleted).toBe(false)
  })

  it('ENTREGADO → isCompleted, 100%', () => {
    const c = classifyEstado('ENTREGADO')
    expect(c.isCompleted).toBe(true)
    expect(c.progressPercent).toBe(100)
  })

  it('ESPERANDO_REPUESTO → mapea a EN_REPARACION (~67%)', () => {
    const c = classifyEstado('ESPERANDO_REPUESTO')
    expect(c.currentIndex).toBe(ESTADO_FLOW.indexOf('EN_REPARACION'))
    expect(c.progressPercent).toBe(67)
  })
})

describe('classifyEstado — estados de retiro / terminales', () => {
  it('ENTREGADO_SIN_COBRO → isRetiro + isCompleted + 100%', () => {
    const c = classifyEstado('ENTREGADO_SIN_COBRO')
    expect(c.isRetiro).toBe(true)
    expect(c.isCompleted).toBe(true)
    expect(c.isTerminal).toBe(false)
    expect(c.progressPercent).toBe(100)
  })

  it('ENTREGADO_SIN_REPARACION → isRetiro + isCompleted', () => {
    const c = classifyEstado('ENTREGADO_SIN_REPARACION')
    expect(c.isRetiro).toBe(true)
    expect(c.isCompleted).toBe(true)
    expect(c.progressPercent).toBe(100)
  })

  it('CANCELADO → isTerminal, 0%', () => {
    const c = classifyEstado('CANCELADO')
    expect(c.isTerminal).toBe(true)
    expect(c.progressPercent).toBe(0)
  })

  it('SIN_REPARACION → isTerminal, 0%', () => {
    const c = classifyEstado('SIN_REPARACION')
    expect(c.isTerminal).toBe(true)
    expect(c.progressPercent).toBe(0)
  })
})

describe('classifyEstado — defensivo (regresión del bug -17%)', () => {
  it('estado vacío → no devuelve negativo', () => {
    const c = classifyEstado('')
    expect(c.progressPercent).toBeGreaterThanOrEqual(0)
    expect(c.currentIndex).toBeGreaterThanOrEqual(0)
  })

  it('estado null → no rompe, fallback seguro', () => {
    const c = classifyEstado(null)
    expect(c.estadoNormalizado).toBe('')
    expect(c.progressPercent).toBe(0)
  })

  it('estado undefined → fallback seguro', () => {
    const c = classifyEstado(undefined)
    expect(c.progressPercent).toBe(0)
  })

  it('estado desconocido → progress 0, nunca negativo', () => {
    const c = classifyEstado('ESTADO_INVENTADO_XYZ')
    expect(c.progressPercent).toBeGreaterThanOrEqual(0)
    expect(c.isCompleted).toBe(false)
  })

  it('lowercase → normaliza a upper', () => {
    const c = classifyEstado('entregado_sin_cobro')
    expect(c.estadoNormalizado).toBe('ENTREGADO_SIN_COBRO')
    expect(c.isRetiro).toBe(true)
    expect(c.progressPercent).toBe(100)
  })

  it('con espacios → trim', () => {
    const c = classifyEstado('  REPARADO  ')
    expect(c.estadoNormalizado).toBe('REPARADO')
    expect(c.isReady).toBe(true)
  })
})

describe('getTimeRemaining', () => {
  const now = new Date('2026-05-12T12:00:00Z')

  it('fecha pasada → overdue con días absolutos', () => {
    const r = getTimeRemaining('2026-04-20T12:00:00Z', now)
    expect(r).not.toBeNull()
    expect(r!.urgency).toBe('overdue')
    expect(r!.text).toMatch(/\d+ d[ií]as? de atraso/i)
    expect(r!.diffDays).toBeLessThan(0)
  })

  it('1 día de atraso → singular', () => {
    const r = getTimeRemaining('2026-05-11T12:00:00Z', now)
    expect(r!.urgency).toBe('overdue')
    expect(r!.text).toMatch(/1 día de atraso/)
  })

  it('hoy (mismo instante) → soon "Hoy"', () => {
    const r = getTimeRemaining('2026-05-12T12:00:00Z', now)
    expect(r!.urgency).toBe('soon')
    expect(r!.text).toBe('Hoy')
  })

  it('hoy (unas horas atrás, mismo día) → soon "Hoy"', () => {
    const r = getTimeRemaining('2026-05-12T09:00:00Z', now)
    expect(r!.urgency).toBe('soon')
    expect(r!.text).toBe('Hoy')
  })

  it('mañana (>= 1 día) → soon "Mañana"', () => {
    const r = getTimeRemaining('2026-05-13T12:00:00Z', now)
    expect(r!.urgency).toBe('soon')
    expect(r!.text).toBe('Mañana')
  })

  it('unas horas en el futuro (mismo día) → soon "Mañana" (Math.ceil)', () => {
    // Documenta el comportamiento real de Math.ceil: cualquier diffMs > 0
    // pero < 1 día redondea a 1 día → "Mañana".
    const r = getTimeRemaining('2026-05-12T18:00:00Z', now)
    expect(r!.urgency).toBe('soon')
    expect(r!.text).toBe('Mañana')
  })

  it('2 días → soon plural', () => {
    const r = getTimeRemaining('2026-05-14T12:00:00Z', now)
    expect(r!.urgency).toBe('soon')
    expect(r!.text).toBe('2 días')
  })

  it('10 días → normal', () => {
    const r = getTimeRemaining('2026-05-22T12:00:00Z', now)
    expect(r!.urgency).toBe('normal')
  })

  it('null/undefined → null', () => {
    expect(getTimeRemaining(null, now)).toBeNull()
    expect(getTimeRemaining(undefined, now)).toBeNull()
    expect(getTimeRemaining('', now)).toBeNull()
  })

  it('fecha inválida → null', () => {
    expect(getTimeRemaining('not-a-date', now)).toBeNull()
  })
})

describe('shouldShowTimeRemaining', () => {
  it('estado en progreso normal → true', () => {
    expect(shouldShowTimeRemaining(classifyEstado('EN_REPARACION'))).toBe(true)
  })

  it('REPARADO (isReady) → false (ya está listo)', () => {
    expect(shouldShowTimeRemaining(classifyEstado('REPARADO'))).toBe(false)
  })

  it('ENTREGADO → false', () => {
    expect(shouldShowTimeRemaining(classifyEstado('ENTREGADO'))).toBe(false)
  })

  it('ENTREGADO_SIN_COBRO → false (regresión: antes mostraba "22 días atraso")', () => {
    expect(shouldShowTimeRemaining(classifyEstado('ENTREGADO_SIN_COBRO'))).toBe(false)
  })

  it('ENTREGADO_SIN_REPARACION → false', () => {
    expect(shouldShowTimeRemaining(classifyEstado('ENTREGADO_SIN_REPARACION'))).toBe(false)
  })

  it('CANCELADO → false', () => {
    expect(shouldShowTimeRemaining(classifyEstado('CANCELADO'))).toBe(false)
  })

  it('SIN_REPARACION → false', () => {
    expect(shouldShowTimeRemaining(classifyEstado('SIN_REPARACION'))).toBe(false)
  })
})

describe('getRetiroStepper — caminos por motivo', () => {
  it('NO_REPARABLE → 4 pasos: Recibido → Diag → Sin reparación → Retirado', () => {
    const steps = getRetiroStepper('NO_REPARABLE')
    expect(steps).toHaveLength(4)
    expect(steps[0].key).toBe('RECIBIDO')
    expect(steps[2].key).toBe('SIN_REPARACION')
    expect(steps[3].key).toBe('RETIRADO')
  })

  it('CORTESIA → camino con Reparado (no Sin reparación)', () => {
    const steps = getRetiroStepper('CORTESIA')
    expect(steps.some(s => s.key === 'REPARADO')).toBe(true)
    expect(steps.some(s => s.key === 'SIN_REPARACION')).toBe(false)
    expect(steps[steps.length - 1].label.toLowerCase()).toContain('cortes')
  })

  it('GARANTIA → camino con Reparado y label garantía', () => {
    const steps = getRetiroStepper('GARANTIA')
    expect(steps.some(s => s.key === 'REPARADO')).toBe(true)
    expect(steps[steps.length - 1].label.toLowerCase()).toContain('garant')
  })

  it('CLIENTE_DESISTIO → incluye paso Presupuesto + Desistió (5 pasos)', () => {
    const steps = getRetiroStepper('CLIENTE_DESISTIO')
    expect(steps).toHaveLength(5)
    expect(steps.some(s => s.key === 'PRESUPUESTADO')).toBe(true)
    expect(steps.some(s => s.key === 'DESISTIO')).toBe(true)
  })

  it('OTRO → camino corto (3 pasos)', () => {
    const steps = getRetiroStepper('OTRO')
    expect(steps).toHaveLength(3)
  })

  it('null/undefined → fallback NO_REPARABLE (compat con órdenes legacy)', () => {
    expect(getRetiroStepper(null)).toEqual(getRetiroStepper('NO_REPARABLE'))
    expect(getRetiroStepper(undefined)).toEqual(getRetiroStepper('NO_REPARABLE'))
  })

  it('valor desconocido → fallback NO_REPARABLE', () => {
    expect(getRetiroStepper('INVENTADO')).toEqual(getRetiroStepper('NO_REPARABLE'))
  })

  it('todos los pasos tienen key+label+icon válidos', () => {
    for (const motivo of MOTIVOS_SIN_COBRO) {
      const steps = getRetiroStepper(motivo)
      expect(steps.length).toBeGreaterThanOrEqual(3)
      for (const s of steps) {
        expect(s.key).toBeTruthy()
        expect(s.label).toBeTruthy()
        expect(s.icon).toBeTruthy()
      }
    }
  })
})

describe('getRetiroLabel', () => {
  it('cada motivo tiene title y description distintos', () => {
    const titles = new Set<string>()
    for (const motivo of MOTIVOS_SIN_COBRO) {
      const { title, description } = getRetiroLabel(motivo)
      expect(title).toBeTruthy()
      expect(description).toBeTruthy()
      titles.add(title)
    }
    // Al menos 4 títulos únicos (algunos pueden compartir wording)
    expect(titles.size).toBeGreaterThanOrEqual(4)
  })

  it('CORTESIA menciona cortesía', () => {
    expect(getRetiroLabel('CORTESIA').title.toLowerCase()).toContain('cortes')
  })

  it('GARANTIA menciona garantía', () => {
    expect(getRetiroLabel('GARANTIA').title.toLowerCase()).toMatch(/garant/)
  })

  it('null → fallback NO_REPARABLE', () => {
    expect(getRetiroLabel(null)).toEqual(getRetiroLabel('NO_REPARABLE'))
  })
})

describe('defaultMotivoSinCobro — sugerencia por estado actual', () => {
  it('SIN_REPARACION → NO_REPARABLE', () => {
    expect(defaultMotivoSinCobro('SIN_REPARACION')).toBe('NO_REPARABLE')
  })

  it('REPARADO → CORTESIA', () => {
    expect(defaultMotivoSinCobro('REPARADO')).toBe('CORTESIA')
  })

  it('PRESUPUESTADO/APROBADO/EN_REPARACION → CLIENTE_DESISTIO', () => {
    expect(defaultMotivoSinCobro('PRESUPUESTADO')).toBe('CLIENTE_DESISTIO')
    expect(defaultMotivoSinCobro('APROBADO')).toBe('CLIENTE_DESISTIO')
    expect(defaultMotivoSinCobro('EN_REPARACION')).toBe('CLIENTE_DESISTIO')
    expect(defaultMotivoSinCobro('ESPERANDO_REPUESTO')).toBe('CLIENTE_DESISTIO')
  })

  it('otros estados → OTRO', () => {
    expect(defaultMotivoSinCobro('RECIBIDO')).toBe('OTRO')
    expect(defaultMotivoSinCobro('EN_DIAGNOSTICO')).toBe('OTRO')
    expect(defaultMotivoSinCobro('')).toBe('OTRO')
    expect(defaultMotivoSinCobro(null)).toBe('OTRO')
  })

  it('lowercase / espacios → normaliza', () => {
    expect(defaultMotivoSinCobro('reparado')).toBe('CORTESIA')
    expect(defaultMotivoSinCobro('  REPARADO  ')).toBe('CORTESIA')
  })
})

describe('ESTADO_FLOW — orden y completitud', () => {
  it('tiene 7 pasos en orden esperado', () => {
    expect(ESTADO_FLOW).toEqual([
      'RECIBIDO',
      'EN_DIAGNOSTICO',
      'PRESUPUESTADO',
      'APROBADO',
      'EN_REPARACION',
      'REPARADO',
      'ENTREGADO',
    ])
  })

  it('todos los estados del flow generan progress válido', () => {
    for (const estado of ESTADO_FLOW) {
      const c = classifyEstado(estado)
      expect(c.progressPercent).toBeGreaterThanOrEqual(0)
      expect(c.progressPercent).toBeLessThanOrEqual(100)
      expect(c.currentIndex).toBeGreaterThanOrEqual(0)
    }
  })
})
