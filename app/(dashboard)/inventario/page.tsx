"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { InventarioList } from "@/components/inventario/inventario-list"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"
import { Button } from "@/components/ui/button"
import { BarChart3 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

export default function InventarioPage() {
  const [showAnalytics, setShowAnalytics] = useState(false)
  const { data: session, status } = useSession()
  const router = useRouter()
  const [accesoVendedor, setAccesoVendedor] = useState<boolean | null>(null)
  const [sesionConocida, setSesionConocida] = useState(false)

  useEffect(() => {
    if (status === "authenticated") setSesionConocida(true)
  }, [status])

  useEffect(() => {
    if (session?.user?.role !== "VENDEDOR") return
    fetch("/api/org/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.vendedoresAdministranInventario) setAccesoVendedor(true)
        else router.replace("/dashboard")
      })
      .catch(() => router.replace("/dashboard"))
  }, [session, router])

  // Solo ocultamos la página en la carga inicial. Un refresco de sesión deja
  // status en "loading" un instante, y desmontar acá tiraba abajo todo el
  // subárbol: se perdía el modal de importación con el archivo ya elegido.
  if (status === "loading" && !sesionConocida) return null
  if (session?.user?.role === "VENDEDOR" && accesoVendedor !== true) return null

  return (
    <PageShell
      title="Inventario"
      description="Gestiona el stock de repuestos, accesorios y productos"
      actions={
        <Button variant="outline" onClick={() => setShowAnalytics(true)} className="gap-1.5 flex-1 sm:flex-none">
          <BarChart3 className="h-4 w-4" />
          Análisis
        </Button>
      }
    >
      <InventarioList />

      <InventarioAnalytics open={showAnalytics} onOpenChange={setShowAnalytics} />
    </PageShell>
  )
}
