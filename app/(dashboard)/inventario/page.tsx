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
  const { data: session } = useSession()
  const router = useRouter()
  const [accesoVendedor, setAccesoVendedor] = useState<boolean | null>(null)

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
