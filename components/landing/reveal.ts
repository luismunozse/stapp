import type { Variants } from "framer-motion"

// ============================================================
// Reveal presets — un reveal por TIPO de contenido, no uno para todo.
// Rompe el "uniform reflex" (toda sección entrando con el mismo y:30).
// Curvas fuertes (Emil Kowalski): las default de framer son flojas.
// MotionConfig reducedMotion="user" (en page.tsx) descarta los transforms
// y deja solo opacity cuando el usuario pide movimiento reducido.
// ============================================================

// ease-out fuerte para UI: arranca rápido, se siente responsivo.
const easeOut = [0.23, 1, 0.32, 1] as const
// ease-out suave para listas/filas.
const easeOutSoft = [0.25, 0.4, 0.25, 1] as const

// Encabezado de sección: sube y se asienta. Corto y crisp.
export const revealHeader: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: easeOut } },
}

// Panel estructurado (tabla, card grande): se asienta en su lugar, NO se desliza.
export const revealPanel: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: easeOut } },
}

// Card focal (pricing): se presenta con un leve scale. Nunca desde scale(0).
export const revealFocal: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.45, ease: easeOut } },
}

// Card de grid (casos de uso): sube. Reading order L→R, top→bottom vía stagger.
export const revealCard: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
}

// Fila de lista (FAQ, filas de tabla mobile): entra desde el borde de lectura.
export const revealRow: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: easeOutSoft } },
}

// Contenedor que escalona a sus hijos. Stagger corto (Emil: 30–80ms).
export const revealStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
}

// Variante de stagger para listas largas (tabla 18 filas): más rápido aún.
export const revealStaggerFast: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
}
