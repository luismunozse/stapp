/**
 * Constantes de animación estandarizadas para toda la aplicación
 * Usar estas constantes para mantener consistencia en duraciones y easings
 */
export const ANIMATION = {
  /**
   * Duraciones en milisegundos
   */
  duration: {
    /** Micro-interacciones (hover, focus) - 200ms */
    fast: 200,
    /** Transiciones estándar (modales, slides) - 300ms */
    normal: 300,
    /** Animaciones complejas (loaders, progress) - 500ms */
    slow: 500,
  },

  /**
   * Funciones de easing CSS
   */
  easing: {
    /** Default easing para la mayoría de transiciones */
    default: 'cubic-bezier(0.4, 0, 0.2, 1)', // ease-out
    /** Easing suave para movimientos naturales */
    smooth: 'cubic-bezier(0.4, 0, 0.6, 1)', // custom smooth
    /** Easing para entrada de elementos */
    in: 'cubic-bezier(0.4, 0, 1, 1)', // ease-in
    /** Easing para salida de elementos */
    out: 'cubic-bezier(0, 0, 0.2, 1)', // ease-out
  },
} as const

/**
 * Tipos derivados para TypeScript
 */
export type AnimationDuration = keyof typeof ANIMATION.duration
export type AnimationEasing = keyof typeof ANIMATION.easing
