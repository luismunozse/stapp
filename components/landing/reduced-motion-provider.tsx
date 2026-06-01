"use client"

import { MotionConfig } from "framer-motion"
import type { ReactNode } from "react"

// Envuelve la landing para que TODA animación framer-motion (m.*) respete
// prefers-reduced-motion del sistema. Con reducedMotion="user", framer descarta
// transforms (x/y/scale/rotate) y deja solo opacity cuando el usuario pidió
// movimiento reducido. Un solo punto en vez de parchear cada sección.
export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
