"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FacturacionList } from "@/components/facturacion/facturacion-list"
import { ComprobantesArcaList } from "@/components/facturacion/comprobantes-arca-list"

const PROBE_URL = "/api/facturacion-electronica/comprobantes?limit=1"

/**
 * /facturacion: "Remitos" siempre; "Comprobantes ARCA" solo para ADMIN y solo si
 * la org ya tiene facturas electrónicas o hoy puede emitirlas. El árbol es el
 * mismo con o sin pestaña ARCA, así que los remitos no se remontan al aparecer.
 */
export function ComprobantesTabs() {
  const { data: session } = useSession()
  const esAdmin = session?.user?.role === "ADMIN"
  const [tab, setTab] = useState("remitos")
  const [mostrarArca, setMostrarArca] = useState(false)

  useEffect(() => {
    if (!esAdmin) return
    let cancelado = false
    ;(async () => {
      try {
        const res = await fetch(PROBE_URL)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelado) setMostrarArca((data?.total ?? 0) > 0 || data?.puedeEmitir === true)
      } catch {
        // Sin la sonda quedan solo los remitos, como siempre.
      }
    })()
    return () => {
      cancelado = true
    }
  }, [esAdmin])

  const arcaVisible = esAdmin && mostrarArca

  return (
    <Tabs value={arcaVisible ? tab : "remitos"} onValueChange={setTab}>
      {arcaVisible && (
        <TabsList className="mb-2">
          <TabsTrigger value="remitos">Remitos</TabsTrigger>
          <TabsTrigger value="arca">Comprobantes ARCA</TabsTrigger>
        </TabsList>
      )}
      <TabsContent value="remitos" forceMount className="mt-0" tabIndex={arcaVisible ? 0 : -1}>
        <FacturacionList />
      </TabsContent>
      {arcaVisible && (
        <TabsContent value="arca" className="mt-0">
          <ComprobantesArcaList />
        </TabsContent>
      )}
    </Tabs>
  )
}
