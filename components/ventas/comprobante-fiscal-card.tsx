"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, ExternalLink, FileCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CONTACT_EMAIL } from "@/lib/contact"
import { emitirComprobanteArca } from "@/lib/facturacion/emitir-comprobante-client"
import {
  etiquetaEstadoComprobante,
  fechaFiscalDMA,
  pdfComprobanteHref,
  tituloComprobante,
  type ComprobanteFiscalDTO,
  type ListadoComprobantesResponse,
} from "@/lib/facturacion/comprobante-ui"

interface ComprobanteFiscalCardProps {
  ventaId: string
  estadoVenta: string
  tieneDevoluciones: boolean
}

/**
 * Bloque fiscal de la ficha de venta (solo ADMIN, lo monta el padre). Muestra el
 * ultimo comprobante de la venta y, si corresponde, deja emitirlo. El servidor
 * valida de nuevo cada regla: esto solo evita ofrecer lo que va a fallar.
 */
export function ComprobanteFiscalCard({ ventaId, estadoVenta, tieneDevoluciones }: ComprobanteFiscalCardProps) {
  const [comprobante, setComprobante] = useState<ComprobanteFiscalDTO | null>(null)
  const [puedeEmitir, setPuedeEmitir] = useState(false)
  const [cargado, setCargado] = useState(false)
  const [emitiendo, setEmitiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El estado se actualiza en el render siguiente: el ref frena un segundo click inmediato.
  const emitiendoRef = useRef(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/facturacion-electronica/comprobantes?ventaId=${encodeURIComponent(ventaId)}&limit=1`)
      if (!res.ok) return
      const data = (await res.json()) as Partial<ListadoComprobantesResponse>
      setComprobante(data.items?.[0] ?? null)
      setPuedeEmitir(data.puedeEmitir === true)
    } catch {
      // Sin datos fiscales el bloque simplemente no aparece.
    } finally {
      setCargado(true)
    }
  }, [ventaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const handleEmitir = async () => {
    if (emitiendoRef.current) return
    emitiendoRef.current = true
    setEmitiendo(true)
    setError(null)
    const resultado = await emitirComprobanteArca(ventaId)
    if (resultado.kind === "error") {
      setError(resultado.message)
    } else if (resultado.kind === "yaEmitido" && !resultado.comprobante && resultado.message) {
      setError(resultado.message)
    }
    // Pase lo que pase se vuelve a leer: el servidor es la fuente de verdad.
    await cargar()
    emitiendoRef.current = false
    setEmitiendo(false)
  }

  if (!cargado) return null

  const ventaEmitible = estadoVenta === "COMPLETADA" && !tieneDevoluciones && puedeEmitir
  const sinComprobante = comprobante === null
  const rechazado = comprobante?.estado === "rechazado"
  const puedeOfrecerEmision = ventaEmitible && (sinComprobante || rechazado)

  if (sinComprobante && !puedeOfrecerEmision) return null

  const errorVisible = error && error !== comprobante?.errorMsg ? error : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck className="h-4 w-4" />
            Factura electrónica
          </CardTitle>
          {comprobante && (
            <Badge variant={comprobante.estado === "emitido" ? "successSoft" : rechazado ? "destructiveSoft" : "warningSoft"}>
              {etiquetaEstadoComprobante(comprobante.estado)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {comprobante?.estado === "emitido" && <DatosEmitido comprobante={comprobante} />}

        {comprobante?.estado === "pendiente" && (
          <p className="text-sm text-muted-foreground">
            La factura se está procesando. Recargá la página en unos minutos. Si sigue así, escribinos a{" "}
            {CONTACT_EMAIL} y lo revisamos antes de volver a emitir, para no duplicar la factura.
          </p>
        )}

        {rechazado && comprobante.errorMsg && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{comprobante.errorMsg}</span>
          </p>
        )}

        {sinComprobante && (
          <p className="text-sm text-muted-foreground">Esta venta todavía no tiene factura electrónica.</p>
        )}

        {errorVisible && (
          <p role="alert" className="text-sm text-destructive">
            {errorVisible}
          </p>
        )}

        {puedeOfrecerEmision && (
          <Button variant={rechazado ? "outline" : "default"} onClick={handleEmitir} disabled={emitiendo}>
            {emitiendo ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Emitiendo...
              </>
            ) : rechazado ? (
              "Reintentar"
            ) : (
              "Emitir factura electrónica"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function DatosEmitido({ comprobante }: { comprobante: ComprobanteFiscalDTO }) {
  return (
    <div className="space-y-3">
      <div className="font-medium">{tituloComprobante(comprobante.tipo, comprobante.numero)}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">CAE</dt>
        <dd className="break-all font-mono">{comprobante.cae ?? "-"}</dd>
        <dt className="text-muted-foreground">Vencimiento del CAE</dt>
        <dd>{fechaFiscalDMA(comprobante.caeVencimiento)}</dd>
      </dl>
      {comprobante.pdfDisponible ? (
        <Button asChild variant="outline" size="sm">
          <a href={pdfComprobanteHref(comprobante.id)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Ver PDF
          </a>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          El PDF no está disponible: esta factura se emitió con datos incompletos.
        </p>
      )}
    </div>
  )
}
