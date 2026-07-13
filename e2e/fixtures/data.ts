import { uniqueSuffix } from "../helpers/utils"

/**
 * Test data factories. These produce the payloads typed into STApp forms.
 * Each call is unique (suffix) so repeated runs don't collide — keeping tests
 * idempotent. Values match the real form fields verified in components/ordenes
 * and components/tecnicos.
 */

export function makeOrden(overrides: Partial<OrdenInput> = {}): OrdenInput {
  const s = uniqueSuffix()
  return {
    marca: "QA-Marca",
    dispositivo: `QA-Equipo-${s}`,
    problema: `No enciende — caso E2E ${s}`,
    presupuesto: "15000",
    ...overrides,
  }
}

export interface OrdenInput {
  marca: string
  /** Maps to "Modelo / Dispositivo *". */
  dispositivo: string
  /** Maps to "Problema Reportado *". */
  problema: string
  /** Maps to "Presupuesto (Opcional)". */
  presupuesto: string
}

export function makeTecnico(overrides: Partial<TecnicoInput> = {}): TecnicoInput {
  const s = uniqueSuffix()
  return {
    nombre: `QA Tecnico ${s}`,
    email: `qa-tecnico-${s}@e2e.local`,
    password: "Passw0rd!E2E",
    comision: "10",
    ...overrides,
  }
}

export interface TecnicoInput {
  nombre: string
  email: string
  password: string
  /** "% Comisión sobre ganancia" (0-100). */
  comision: string
}
