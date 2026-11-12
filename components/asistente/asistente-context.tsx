"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"

// El panel se carga recién la primera vez que se abre (no suma al bundle inicial).
const AsistentePanel = dynamic(
  () => import("./asistente-panel").then((mod) => mod.AsistentePanel),
  { ssr: false }
)

interface AsistenteContextValue {
  /** El plan de la organización incluye el asistente. */
  enabled: boolean
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const AsistenteContext = createContext<AsistenteContextValue | null>(null)

export function AsistenteProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  // Una vez abierto, el panel queda montado para conservar la conversación al cerrarlo.
  const [mounted, setMounted] = useState(false)

  const setOpen = useCallback((next: boolean) => {
    if (next) setMounted(true)
    setOpenState(next)
  }, [])
  const toggle = useCallback(() => setOpen(!open), [open, setOpen])

  const value = useMemo(() => ({ enabled, open, setOpen, toggle }), [enabled, open, setOpen, toggle])

  return (
    <AsistenteContext.Provider value={value}>
      {children}
      {enabled && mounted && <AsistentePanel open={open} onClose={() => setOpen(false)} />}
    </AsistenteContext.Provider>
  )
}

/** Devuelve null fuera del provider (por ejemplo, en tests que montan el navbar solo). */
export function useAsistente() {
  return useContext(AsistenteContext)
}
