/**
 * Catálogo de dibujos (line art) para el diagrama de daños.
 * Módulo puro: los paths se dibujan igual como <path d> en SVG y con
 * drawSvgPath de pdf-lib (solo comandos absolutos/relativos simples, sin transforms).
 * La base guarda la referencia "<id>@<version>" (ej. "celular@1").
 */

export type VistaId = "frente" | "dorso" | "lateral"

export interface VistaDiagrama {
  id: VistaId
  label: string
  viewBox: string
  paths: string[]
}

export interface Diagrama {
  id: string
  version: number
  vistas: VistaDiagrama[]
}

export const DIAGRAMA_GENERICO_ID = "generico"

// ── helpers de trazado (devuelven path data) ────────────────────────────────

const n = (v: number) => String(Math.round(v * 100) / 100)

/** Rectángulo con esquinas redondeadas. */
function rr(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(x + w - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}`,
    `V${n(y + h - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}`,
    `H${n(x + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}`,
    `V${n(y + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}`,
    "Z",
  ].join(" ")
}

/** Círculo como dos arcos. */
function circ(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)} A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)} A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)} Z`
}

/** Segmento de línea. */
function ln(x1: number, y1: number, x2: number, y2: number): string {
  return `M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)}`
}

const VB_VERTICAL = "0 0 100 200"
const VB_HORIZONTAL = "0 0 200 140"

// ── celular / tablet ────────────────────────────────────────────────────────

const celular: Diagrama = {
  id: "celular",
  version: 1,
  vistas: [
    {
      id: "frente",
      label: "Frente",
      viewBox: VB_VERTICAL,
      paths: [
        rr(10, 4, 80, 192, 12), // carcasa
        rr(15, 20, 70, 160, 3), // pantalla
        rr(40, 10, 20, 3, 1.5), // parlante
        circ(30, 11.5, 2), // cámara frontal
        ln(40, 190, 60, 190), // barra inferior
      ],
    },
    {
      id: "dorso",
      label: "Dorso",
      viewBox: VB_VERTICAL,
      paths: [
        rr(10, 4, 80, 192, 12), // carcasa
        rr(16, 11, 34, 34, 9), // módulo de cámaras
        circ(26, 21, 5),
        circ(26, 35, 5),
        circ(40, 28, 3),
        circ(50, 100, 9), // logo
      ],
    },
  ],
}

const tablet: Diagrama = {
  id: "tablet",
  version: 1,
  vistas: [
    {
      id: "frente",
      label: "Frente",
      viewBox: VB_VERTICAL,
      paths: [
        rr(6, 10, 88, 180, 8), // carcasa
        rr(12, 20, 76, 160, 2), // pantalla
        circ(50, 15, 2), // cámara frontal
        ln(40, 186, 60, 186),
      ],
    },
    {
      id: "dorso",
      label: "Dorso",
      viewBox: VB_VERTICAL,
      paths: [
        rr(6, 10, 88, 180, 8), // carcasa
        rr(12, 16, 24, 24, 7), // módulo de cámara
        circ(24, 28, 5),
        circ(50, 100, 8), // logo
      ],
    },
  ],
}

// ── computadora (notebook) ──────────────────────────────────────────────────

const computadora: Diagrama = {
  id: "computadora",
  version: 1,
  vistas: [
    {
      id: "frente",
      label: "Abierta",
      viewBox: VB_HORIZONTAL,
      paths: [
        rr(30, 6, 140, 80, 6), // tapa
        rr(36, 12, 128, 68, 2), // pantalla
        circ(100, 9, 1.5), // webcam
        "M30 94 H170 L190 128 Q191 134 184 134 H16 Q9 134 10 128 Z", // base
        rr(30, 100, 140, 18, 2), // teclado
        rr(80, 122, 40, 8, 2), // touchpad
      ],
    },
    {
      id: "dorso",
      label: "Tapa cerrada",
      viewBox: VB_HORIZONTAL,
      paths: [
        rr(15, 15, 170, 110, 10), // tapa
        circ(100, 70, 12), // logo
      ],
    },
  ],
}

// ── consola ─────────────────────────────────────────────────────────────────

const consola: Diagrama = {
  id: "consola",
  version: 1,
  vistas: [
    {
      id: "frente",
      label: "Frente",
      viewBox: VB_HORIZONTAL,
      paths: [
        rr(10, 20, 100, 96, 8), // equipo
        ln(22, 32, 98, 32), // ranura de disco
        circ(98, 100, 3), // botón
        // joystick (control)
        "M132 64 Q132 52 146 52 H178 Q192 52 192 64 L196 100 Q197 116 186 116 Q178 116 174 108 L170 100 H154 L150 108 Q146 116 138 116 Q127 116 128 100 Z",
        circ(144, 74, 6), // stick izquierdo
        circ(172, 90, 6), // stick derecho
        circ(180, 70, 2),
      ],
    },
    {
      id: "dorso",
      label: "Dorso",
      viewBox: VB_HORIZONTAL,
      paths: [
        rr(10, 20, 180, 100, 8), // equipo
        rr(24, 40, 22, 12, 2), // HDMI
        rr(54, 40, 14, 12, 2), // USB
        rr(76, 40, 14, 12, 2), // USB
        rr(130, 40, 40, 14, 2), // alimentación
        ln(24, 80, 176, 80), // rejilla de ventilación
        ln(24, 88, 176, 88),
        ln(24, 96, 176, 96),
      ],
    },
  ],
}

// ── smartwatch ──────────────────────────────────────────────────────────────

const smartwatch: Diagrama = {
  id: "smartwatch",
  version: 1,
  vistas: [
    {
      id: "frente",
      label: "Frente",
      viewBox: VB_VERTICAL,
      paths: [
        "M32 70 L36 10 H64 L68 70", // correa superior
        "M32 130 L36 190 H64 L68 130", // correa inferior
        rr(20, 60, 60, 80, 16), // caja
        rr(26, 68, 48, 64, 11), // pantalla
        rr(80, 85, 5, 16, 2), // corona
      ],
    },
    {
      id: "dorso",
      label: "Dorso",
      viewBox: VB_VERTICAL,
      paths: [
        "M32 70 L36 10 H64 L68 70", // correa superior
        "M32 130 L36 190 H64 L68 130", // correa inferior
        rr(20, 60, 60, 80, 16), // caja
        circ(50, 100, 20), // sensor
        circ(50, 100, 10),
      ],
    },
  ],
}

// ── impresora ───────────────────────────────────────────────────────────────

const impresora: Diagrama = {
  id: "impresora",
  version: 1,
  vistas: [
    {
      id: "frente",
      label: "Frente",
      viewBox: VB_HORIZONTAL,
      paths: [
        rr(10, 50, 180, 70, 8), // cuerpo
        "M45 50 V18 Q45 14 49 14 H151 Q155 14 155 18 V50", // bandeja de entrada
        rr(40, 96, 120, 18, 2), // bandeja de salida
        rr(24, 62, 40, 10, 2), // panel
        circ(170, 66, 3), // botón
      ],
    },
    {
      id: "dorso",
      label: "Dorso",
      viewBox: VB_HORIZONTAL,
      paths: [
        rr(10, 40, 180, 80, 8), // cuerpo
        rr(24, 56, 16, 12, 2), // USB
        rr(50, 56, 20, 14, 2), // red
        rr(140, 56, 36, 14, 2), // alimentación
        ln(24, 90, 176, 90), // ventilación
        ln(24, 98, 176, 98),
      ],
    },
  ],
}

// ── genérico ────────────────────────────────────────────────────────────────

const generico: Diagrama = {
  id: DIAGRAMA_GENERICO_ID,
  version: 1,
  vistas: [
    {
      id: "frente",
      label: "Frente",
      viewBox: VB_HORIZONTAL,
      paths: [rr(10, 10, 180, 120, 14)],
    },
    {
      id: "dorso",
      label: "Dorso",
      viewBox: VB_HORIZONTAL,
      paths: [rr(10, 10, 180, 120, 14)],
    },
  ],
}

// ── registro ────────────────────────────────────────────────────────────────

const TODOS_LOS_DIAGRAMAS: Diagrama[] = [
  celular,
  tablet,
  computadora,
  consola,
  smartwatch,
  impresora,
  generico,
]

const REGISTRO: Record<string, Diagrama> = Object.fromEntries(
  TODOS_LOS_DIAGRAMAS.map((d) => [`${d.id}@${d.version}`, d]),
)

/** Código de tipo de dispositivo → id de diagrama. */
const ID_POR_TIPO: Record<string, string> = {
  CELULAR: "celular",
  TABLET: "tablet",
  COMPUTADORA: "computadora",
  CONSOLA: "consola",
  SMARTWATCH: "smartwatch",
  IMPRESORA: "impresora",
}

/** Última versión registrada de cada id. */
function ultimaVersion(id: string): Diagrama {
  let mejor: Diagrama | undefined
  for (const d of TODOS_LOS_DIAGRAMAS) {
    if (d.id === id && (!mejor || d.version > mejor.version)) mejor = d
  }
  return mejor ?? generico
}

export function refDiagrama(d: Diagrama): string {
  return `${d.id}@${d.version}`
}

export function resolverDiagrama(codigoTipo: string | null | undefined): Diagrama {
  const id = codigoTipo ? ID_POR_TIPO[codigoTipo.toUpperCase()] : undefined
  return id ? ultimaVersion(id) : generico
}

export function diagramaPorRef(ref: string): Diagrama {
  return REGISTRO[ref] ?? generico
}
