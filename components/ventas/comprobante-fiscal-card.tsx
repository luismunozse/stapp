"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, ExternalLink, FileCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBanner } from "@/components/ui/status-banner"
import { AnularFacturaDialog } from "@/components/ventas/anular-factura-dialog"
import { CONTACT_EMAIL } from "@/lib/contact"
import {
  etiquetaMotivoAnulacion,
  mensajeFacturaAnulada,
  verificarNotaCreditoArca,
  type ResultadoAnulacion,
} from "@/lib/facturacion/anular-comprobante-client"
import { avisoDeAnulacion, avisoDeVerificacion, type Aviso } from "@/lib/facturacion/avisos-anulacion"
import {
  agruparComprobantesVenta,
  notaCreditoPorVerificar,
  puedeAnularFactura,
  type FacturaConNotas,
} from "@/lib/facturacion/comprobantes-venta"
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

/** Una venta tiene pocas facturas, pero cada anulada suma su nota: alcanza de sobra para ver todo el historial reciente. */
const COMPROBANTES_POR_VENTA = 20

const AVISO_FUERA_DE_PLAZO = "Se emitió pasados los 15 días que pide la RG 4540. Consultalo con tu contador."

const tituloNotaCredito = (nota: ComprobanteFiscalDTO) =>
  ["Nota de crédito electrónica", nota.tipo, nota.numero].filter(Boolean).join(" ")

/** Texto del motivo guardado en la nota: "Error en la factura" o "Otro: el detalle". */
function textoMotivo(nota: ComprobanteFiscalDTO): string | null {
  const etiqueta = etiquetaMotivoAnulacion(nota.motivo)
  if (!etiqueta) return null
  return nota.motivoDetalle ? `${etiqueta}: ${nota.motivoDetalle}` : etiqueta
}

/**
 * Bloque fiscal de la ficha de venta (solo ADMIN, lo monta el padre). Muestra la
 * factura vigente con su nota de crédito si fue anulada, el historial de facturas
 * anteriores y, si corresponde, deja emitir, anular o verificar. El servidor valida
 * de nuevo cada regla: esto solo evita ofrecer lo que va a fallar.
 */
export function ComprobanteFiscalCard({ ventaId, estadoVenta, tieneDevoluciones }: ComprobanteFiscalCardProps) {
  const [items, setItems] = useState<ComprobanteFiscalDTO[]>([])
  const [puedeEmitir, setPuedeEmitir] = useState(false)
  const [cargado, setCargado] = useState(false)
  const [emitiendo, setEmitiendo] = useState(false)
  const [verificandoId, setVerificandoId] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  // `abierto` va aparte de la factura para que el dialogo conserve su contenido mientras se cierra.
  const [dialogo, setDialogo] = useState<{ factura: ComprobanteFiscalDTO; abierto: boolean } | null>(null)
  // El estado se actualiza en el render siguiente: los refs frenan un segundo click inmediato.
  const emitiendoRef = useRef(false)
  const verificandoRef = useRef(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/facturacion-electronica/comprobantes?ventaId=${encodeURIComponent(ventaId)}&limit=${COMPROBANTES_POR_VENTA}`
      )
      if (!res.ok) return
      const data = (await res.json()) as Partial<ListadoComprobantesResponse>
      setItems(Array.isArray(data.items) ? data.items : [])
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
    setAviso(null)
    const resultado = await emitirComprobanteArca(ventaId)
    if (resultado.kind === "error") {
      setAviso({ tono: "error", texto: resultado.message })
    } else if (resultado.kind === "yaEmitido" && !resultado.comprobante && resultado.message) {
      setAviso({ tono: "error", texto: resultado.message })
    }
    // Pase lo que pase se vuelve a leer: el servidor es la fuente de verdad.
    await cargar()
    emitiendoRef.current = false
    setEmitiendo(false)
  }

  const handleVerificar = async (nota: ComprobanteFiscalDTO) => {
    if (verificandoRef.current) return
    verificandoRef.current = true
    setVerificandoId(nota.id)
    setAviso(null)
    const resultado = await verificarNotaCreditoArca(nota.id)
    if (resultado.kind === "ok") toast.success(resultado.message)
    else setAviso(avisoDeVerificacion(resultado))
    await cargar()
    verificandoRef.current = false
    setVerificandoId(null)
  }

  // El dialogo avisa de todo desenlace que cambia (o pudo cambiar) la factura.
  const handleResultadoAnulacion = (resultado: ResultadoAnulacion) => {
    if (resultado.kind === "ok") {
      toast.success(
        mensajeFacturaAnulada(resultado.comprobante),
        resultado.fueraDePlazo ? { description: AVISO_FUERA_DE_PLAZO } : undefined
      )
      setAviso(null)
    } else {
      setAviso(avisoDeAnulacion(resultado))
    }
    void cargar()
  }

  if (!cargado) return null

  const { vigente, historial } = agruparComprobantesVenta(items)
  const facturaVigente = vigente?.factura ?? null
  const ventaEmitible = estadoVenta === "COMPLETADA" && !tieneDevoluciones && puedeEmitir
  const rechazado = facturaVigente?.estado === "rechazado"
  const anuladaVigente = facturaVigente?.estado === "anulado"
  const puedeOfrecerEmision = ventaEmitible && (facturaVigente === null || rechazado || anuladaVigente)

  if (facturaVigente === null && !puedeOfrecerEmision) return null

  const avisoVisible = aviso && !(aviso.tono === "error" && aviso.texto === facturaVigente?.errorMsg) ? aviso : null
  const etiquetaEmitir = rechazado ? "Reintentar" : anuladaVigente ? "Emitir factura nueva" : "Emitir factura electrónica"

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck className="h-4 w-4" />
            Factura electrónica
          </CardTitle>
          {facturaVigente && <InsigniaEstado estado={facturaVigente.estado} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {vigente && (
          <FacturaBloque
            grupo={vigente}
            puedeAnular={puedeAnularFactura(vigente, puedeEmitir)}
            onAnular={(factura) => setDialogo({ factura, abierto: true })}
            verificandoId={verificandoId}
            onVerificar={handleVerificar}
          />
        )}

        {facturaVigente === null && (
          <p className="text-sm text-muted-foreground">Esta venta todavía no tiene factura electrónica.</p>
        )}

        {avisoVisible?.tono === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {avisoVisible.texto}
          </p>
        )}
        {avisoVisible?.tono === "warning" && (
          <div role="status">
            <StatusBanner tone="warning" icon={AlertTriangle} className="items-start font-normal">
              {avisoVisible.texto}
            </StatusBanner>
          </div>
        )}

        {puedeOfrecerEmision && (
          <Button variant={rechazado ? "outline" : "default"} onClick={handleEmitir} disabled={emitiendo}>
            {emitiendo ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Emitiendo...
              </>
            ) : (
              etiquetaEmitir
            )}
          </Button>
        )}

        {historial.length > 0 && (
          <section aria-labelledby="facturas-anteriores" className="space-y-3 border-t pt-3">
            <h3 id="facturas-anteriores" className="text-sm font-medium text-muted-foreground">
              Facturas anteriores
            </h3>
            {historial.map((grupo) => (
              <FacturaBloque key={grupo.factura.id} grupo={grupo} />
            ))}
          </section>
        )}
      </CardContent>

      {dialogo && (
        <AnularFacturaDialog
          open={dialogo.abierto}
          onOpenChange={(abierto) => setDialogo((actual) => actual && { ...actual, abierto })}
          factura={dialogo.factura}
          onResultado={handleResultadoAnulacion}
        />
      )}
    </Card>
  )
}

const VARIANTE_ESTADO: Record<string, "successSoft" | "destructiveSoft" | "warningSoft" | "secondary"> = {
  emitido: "successSoft",
  rechazado: "destructiveSoft",
  anulado: "secondary",
}

function InsigniaEstado({ estado }: { estado: string }) {
  return <Badge variant={VARIANTE_ESTADO[estado] ?? "warningSoft"}>{etiquetaEstadoComprobante(estado)}</Badge>
}

interface FacturaBloqueProps {
  grupo: FacturaConNotas
  /** Solo la factura vigente trae acciones; el historial es de lectura. */
  puedeAnular?: boolean
  onAnular?: (factura: ComprobanteFiscalDTO) => void
  verificandoId?: string | null
  onVerificar?: (nota: ComprobanteFiscalDTO) => void
}

function FacturaBloque({ grupo, puedeAnular = false, onAnular, verificandoId = null, onVerificar }: FacturaBloqueProps) {
  const { factura, notasCredito } = grupo
  const esHistorial = onAnular === undefined
  const porVerificar = onVerificar ? notaCreditoPorVerificar(grupo) : null

  return (
    <div className="space-y-3">
      {(factura.estado === "emitido" || factura.estado === "anulado") && (
        <DatosComprobante
          titulo={tituloComprobante(factura.tipo, factura.numero)}
          comprobante={factura}
          // La vigente ya muestra su estado arriba; en el historial cada factura lo lleva consigo.
          insignia={esHistorial ? <InsigniaEstado estado={factura.estado} /> : null}
          sinPdf="El PDF no está disponible: esta factura se emitió con datos incompletos."
        />
      )}

      {factura.estado === "pendiente" && (
        <p className="text-sm text-muted-foreground">
          La factura se está procesando. Recargá la página en unos minutos. Si sigue así, escribinos a {CONTACT_EMAIL} y
          lo revisamos antes de volver a emitir, para no duplicar la factura.
        </p>
      )}

      {factura.estado === "rechazado" && factura.errorMsg && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{factura.errorMsg}</span>
        </p>
      )}

      {notasCredito.map((nota) => (
        <NotaCreditoBloque
          key={nota.id}
          nota={nota}
          onVerificar={porVerificar?.id === nota.id ? onVerificar : undefined}
          verificando={verificandoId === nota.id}
        />
      ))}

      {puedeAnular && onAnular && (
        <Button variant="outline" onClick={() => onAnular(factura)}>
          Anular factura
        </Button>
      )}
    </div>
  )
}

interface NotaCreditoBloqueProps {
  nota: ComprobanteFiscalDTO
  verificando: boolean
  /** Solo si esta nota se puede consultar a ARCA; sin esto no hay boton. */
  onVerificar?: (nota: ComprobanteFiscalDTO) => void
}

function NotaCreditoBloque({ nota, verificando, onVerificar }: NotaCreditoBloqueProps) {
  const titulo = tituloNotaCredito(nota)

  if (nota.estado === "pendiente") {
    return (
      <div className="space-y-2 rounded-md border border-warning/30 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium">{titulo}</div>
          <Badge variant="warningSoft">Pendiente de verificación</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          ARCA puede haber emitido esta nota de crédito, pero todavía no pudimos confirmarlo. No vuelvas a anular la
          factura: primero verificá con ARCA.
        </p>
        {onVerificar ? (
          <Button variant="outline" size="sm" onClick={() => onVerificar(nota)} disabled={verificando}>
            {verificando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Verificando...
              </>
            ) : (
              "Verificar con ARCA"
            )}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Esta nota no se puede verificar desde acá. Escribinos a {CONTACT_EMAIL} y la revisamos.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <DatosComprobante
        titulo={titulo}
        comprobante={nota}
        motivo={textoMotivo(nota)}
        sinPdf="El PDF no está disponible: esta nota de crédito se emitió con datos incompletos."
      />
    </div>
  )
}

interface DatosComprobanteProps {
  titulo: string
  comprobante: ComprobanteFiscalDTO
  sinPdf: string
  insignia?: ReactNode
  motivo?: string | null
}

function DatosComprobante({ titulo, comprobante, sinPdf, insignia = null, motivo = null }: DatosComprobanteProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{titulo}</div>
        {insignia}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {comprobante.fechaEmision && (
          <>
            <dt className="text-muted-foreground">Fecha</dt>
            <dd>{fechaFiscalDMA(comprobante.fechaEmision)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">CAE</dt>
        <dd className="break-all font-mono">{comprobante.cae ?? "-"}</dd>
        <dt className="text-muted-foreground">Vencimiento del CAE</dt>
        <dd>{fechaFiscalDMA(comprobante.caeVencimiento)}</dd>
        {motivo && (
          <>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd>{motivo}</dd>
          </>
        )}
      </dl>
      {comprobante.pdfDisponible ? (
        <Button asChild variant="outline" size="sm">
          <a
            href={pdfComprobanteHref(comprobante.id)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Ver PDF de ${titulo}`}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Ver PDF
          </a>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{sinPdf}</p>
      )}
    </div>
  )
}
