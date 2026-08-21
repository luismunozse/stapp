"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Store, Check, ChevronsUpDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Sucursal {
  id: string
  nombre: string
  principal: boolean
}

const TODAS = "todas"

export function SucursalSwitcher() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [activa, setActiva] = useState<string>(TODAS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    fetch("/api/sucursales")
      .then((r) => r.json())
      .then((d) => setSucursales(d.data || []))
      .catch(() => {})
    // La cookie es httpOnly (no legible en client). Espejamos la selección en
    // localStorage solo para reflejarla en la UI; el server lee la cookie real.
    const mirror =
      typeof window !== "undefined" ? window.localStorage.getItem("sucursal-activa-ui") : null
    if (mirror) setActiva(mirror)
  }, [isAdmin])

  if (!isAdmin) return null
  // Sin multi-sucursal (solo la principal), no mostramos el switcher.
  if (sucursales.length <= 1) return null

  const seleccionar = async (id: string) => {
    setSaving(true)
    try {
      const res = await fetch("/api/sucursales/set-activa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sucursalId: id }),
      })
      if (res.ok) {
        setActiva(id)
        if (typeof window !== "undefined") {
          window.localStorage.setItem("sucursal-activa-ui", id)
          // Acá hubo una limpieza del caché del service worker, esperando su
          // confirmación antes de recargar. Ya no hace falta: CACHEABLE_API_ROUTES
          // quedó vacía, así que no hay respuesta de API guardada —mucho menos
          // una escopeada por sucursal— y esperar al worker le costaba al
          // operador hasta 1500 ms en cada cambio, en un equipo lento, para no
          // borrar nada. Si alguna vez vuelve a entrar una ruta escopeada por
          // sucursal a esa lista hay que volver a limpiar acá; está anotado
          // arriba de la constante, en public/sw.js.
          //
          // Recarga completa: el scope de sucursal afecta datos que se cargan
          // client-side (fetch en useEffect), que router.refresh() no re-dispara.
          // Un reload garantiza que todo se re-fetchee con la nueva sucursal.
          window.location.reload()
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const label =
    activa === TODAS
      ? "Todas las sucursales"
      : sucursales.find((s) => s.id === activa)?.nombre ?? "Sucursal"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <Store className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-[110px] truncate">{label}</span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">Sucursal activa</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={() => seleccionar(TODAS)}>
          <Check className={`mr-2 h-4 w-4 ${activa === TODAS ? "opacity-100" : "opacity-0"}`} />
          Todas las sucursales
        </DropdownMenuItem>
        {sucursales.map((s) => (
          <DropdownMenuItem key={s.id} className="cursor-pointer" onClick={() => seleccionar(s.id)}>
            <Check className={`mr-2 h-4 w-4 ${activa === s.id ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{s.nombre}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
