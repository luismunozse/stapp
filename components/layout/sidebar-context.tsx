"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"

const COOKIE_NAME = "sidebar:state"
const SIDEBAR_WIDTH = "16rem"       // 256px - w-64
const SIDEBAR_WIDTH_ICON = "3.5rem" // 56px - solo iconos

type SidebarContextType = {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (value: boolean) => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 365}`
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false)

  // Leer estado inicial de la cookie
  useEffect(() => {
    const saved = getCookie(COOKIE_NAME)
    if (saved === "collapsed") {
      setCollapsedState(true)
    }
  }, [])

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value)
    setCookie(COOKIE_NAME, value ? "collapsed" : "expanded")
  }, [])

  const toggle = useCallback(() => {
    setCollapsed(!collapsed)
  }, [collapsed, setCollapsed])

  // Atajo de teclado Ctrl+B
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggle])

  // CSS custom properties para que el layout se adapte
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      collapsed ? SIDEBAR_WIDTH_ICON : SIDEBAR_WIDTH
    )
  }, [collapsed])

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
