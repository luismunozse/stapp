export const APP_VERSION = "1.1.0"

export type ChangeType = "feature" | "improvement" | "fix"

export interface ChangeEntry {
  type: ChangeType
  description: string
}

export interface ChangelogVersion {
  version: string
  date: string
  title: string
  changes: ChangeEntry[]
}

/**
 * Changelog ordenado de más reciente a más antiguo.
 * Al agregar una nueva versión, insertarla al principio del array
 * y actualizar APP_VERSION arriba.
 */
export const CHANGELOG: ChangelogVersion[] = [
  {
    version: "1.1.0",
    date: "2026-02-19",
    title: "Ver factura en PDF, app Android y más",
    changes: [
      {
        type: "feature",
        description:
          "Ver y descargar facturas en PDF directamente desde la sección de facturación",
      },
      {
        type: "feature",
        description:
          "App nativa disponible para Android (APK). Próximamente en iOS",
      },
      {
        type: "improvement",
        description:
          "Sección de soporte mejorada para facilitar la comunicación entre usuarios y administradores",
      },
      {
        type: "improvement",
        description:
          "Mejoras generales en la sección de facturación",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-02-16",
    title: "Firma de recepción, métodos de pago y más",
    changes: [
      {
        type: "feature",
        description:
          "Firma digital del cliente al recibir el equipo en reparación",
      },
      {
        type: "feature",
        description:
          "Registro de pagos con múltiples métodos: efectivo, transferencia, tarjeta de débito/crédito y MercadoPago",
      },
      {
        type: "improvement",
        description: "Mejoras en la gestión de órdenes de servicio",
      },
      {
        type: "fix",
        description: "Correcciones generales de estabilidad y rendimiento",
      },
    ],
  },
]

/**
 * Retorna las entradas del changelog que el usuario no ha visto.
 * Si lastSeenVersion es null/undefined, retorna todas las entradas.
 */
export function getNewChanges(
  lastSeenVersion: string | null | undefined
): ChangelogVersion[] {
  if (!lastSeenVersion) {
    return CHANGELOG
  }

  const newChanges: ChangelogVersion[] = []
  for (const entry of CHANGELOG) {
    if (compareVersions(entry.version, lastSeenVersion) > 0) {
      newChanges.push(entry)
    }
  }
  return newChanges
}

/**
 * Compara dos versiones semánticas. Retorna:
 *  > 0 si a > b
 *  < 0 si a < b
 *  0 si son iguales
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number)
  const partsB = b.split(".").map(Number)
  const len = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA !== numB) return numA - numB
  }
  return 0
}
