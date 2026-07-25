"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Check, ExternalLink, Loader2, Tag } from "lucide-react"
import { printDeviceLabel } from "./print-label"
import { ThermalPrintRecepcion, type RecepcionReceiptEquipo } from "./thermal-print-recepcion"
import { construirMensajeRecepcion } from "@/lib/recepcion-whatsapp"
import { generateWhatsAppUrl } from "@/lib/notifications/whatsapp-templates"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

/**
 * Datos de un equipo tal como se enviaron en el submit del formulario.
 * POST /api/recepciones no los devuelve en su respuesta (solo
 * { id, numeroOrden, codigoOrden, dispositivo, publicToken } por orden), asi
 * que el formulario se los pasa a este modal por separado -- ver el seam en
 * recepcion-form.tsx. Alineado por indice con resultado.ordenes.
 */
export interface EquipoRecepcionEnviado {
  problemaReportado: string
  tipoDispositivo?: string | null
  marca?: string | null
  color?: string | null
  accesorios?: string | null
}

/**
 * Resultado que devuelve POST /api/recepciones al crear el lote. Los campos
 * organization* vienen del mismo endpoint (mirroring lo que POST /api/ordenes
 * ya hace para el alta clasica: ver app/api/ordenes/route.ts:544-548) --
 * ninguno depende de un segundo fetch ni de un rol especifico.
 */
export interface RecepcionCreadaResultado {
  recepcion: { id: string; numero: number; codigo: string }
  ordenes: Array<{
    id: string
    numeroOrden: number
    codigoOrden: string
    dispositivo: string
    publicToken: string
  }>
  organizationName: string | null
  organizationTelefono: string | null
  organizationDireccion: string | null
  organizationComprobanteTerminos: string | null
}

interface RecepcionCreadaModalProps {
  open: boolean
  onClose: () => void
  resultado: RecepcionCreadaResultado | null
  /** Alineado por indice con resultado.ordenes. */
  equipos: EquipoRecepcionEnviado[]
  cliente: { nombre: string; telefono: string }
  /** Base64 sin el prefijo data:mime;base64, (formato que entrega SignaturePad). */
  firma?: string | null
  firmaMime?: string | null
}

export function RecepcionCreadaModal({
  open,
  onClose,
  resultado,
  equipos,
  cliente,
  firma,
  firmaMime,
}: RecepcionCreadaModalProps) {
  const { timezone } = useCurrency()
  const { showError } = useModal()
  const [mensaje, setMensaje] = useState("")
  const [printingLabels, setPrintingLabels] = useState(false)

  useEffect(() => {
    if (!resultado) return
    const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
    setMensaje(
      construirMensajeRecepcion({
        organizationName: resultado.organizationName || "",
        clienteNombre: cliente.nombre,
        codigoRecepcion: resultado.recepcion.codigo,
        ordenes: resultado.ordenes.map((o) => ({
          codigoOrden: o.codigoOrden,
          dispositivo: o.dispositivo,
          publicToken: o.publicToken,
        })),
        baseUrl,
      }),
    )
  }, [resultado, cliente.nombre])

  if (!resultado) return null

  const receiptEquipos: RecepcionReceiptEquipo[] = resultado.ordenes.map((orden, i) => ({
    codigoOrden: orden.codigoOrden,
    tipoDispositivo: equipos[i]?.tipoDispositivo ?? null,
    marca: equipos[i]?.marca ?? null,
    dispositivo: orden.dispositivo,
    problemaReportado: equipos[i]?.problemaReportado ?? "",
    accesorios: equipos[i]?.accesorios ?? null,
  }))

  const handlePrintLabels = async () => {
    setPrintingLabels(true)
    // Cuantas etiquetas terminaron de imprimirse antes de un posible fallo --
    // el operador necesita saber si reimprimir una sola o el lote entero.
    let impresas = 0
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
      const fecha = new Date().toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: timezone,
      })
      // Secuencial a proposito: cada printDeviceLabel abre el dialogo de
      // impresion del sistema operativo. Encadenar los await evita que se
      // pisen entre si si se dispararan en paralelo (Promise.all).
      for (let i = 0; i < resultado.ordenes.length; i++) {
        const orden = resultado.ordenes[i]
        await printDeviceLabel(
          {
            codigoOrden: orden.codigoOrden,
            numeroOrden: orden.numeroOrden,
            clienteNombre: cliente.nombre,
            dispositivo: orden.dispositivo,
            problemaReportado: equipos[i]?.problemaReportado ?? "",
            fechaIngreso: fecha,
            publicToken: orden.publicToken,
            organizationName: resultado.organizationName || undefined,
          },
          baseUrl,
        )
        impresas++
      }
    } catch (error) {
      console.error("Error imprimiendo etiquetas de la recepcion:", error)
      await showError(
        impresas > 0
          ? `Se imprimieron ${impresas} de ${resultado.ordenes.length} etiquetas. Revisa la impresora y reimprimi las que faltan.`
          : `No se pudo imprimir ninguna de las ${resultado.ordenes.length} etiquetas. Revisa la impresora e intenta de nuevo.`,
      )
    } finally {
      setPrintingLabels(false)
    }
  }

  const handleOpenWhatsApp = () => {
    const url = generateWhatsAppUrl(cliente.telefono, mensaje)
    window.open(url, "_blank")
  }

  const handleClose = () => {
    setMensaje("")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-600">
            <Check className="h-5 w-5" />
            Recepcion {resultado.recepcion.codigo} creada
          </DialogTitle>
          <DialogDescription>
            Se crearon {resultado.ordenes.length} ordenes con un solo comprobante. Imprimi el
            comprobante, las etiquetas de cada equipo y envia el WhatsApp al cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cliente:</span>
              <span className="font-medium">{cliente.nombre}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Equipos:</span>
              <span className="font-medium">{resultado.ordenes.length}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[140px] [&>button]:w-full [&>button]:h-10">
              <ThermalPrintRecepcion
                data={{
                  codigo: resultado.recepcion.codigo,
                  fecha: new Date().toLocaleString("es-AR", { timeZone: timezone }),
                  clienteNombre: cliente.nombre,
                  clienteTelefono: cliente.telefono || null,
                  organizationName: resultado.organizationName,
                  organizationTelefono: resultado.organizationTelefono,
                  organizationDireccion: resultado.organizationDireccion,
                  organizationComprobanteTerminos: resultado.organizationComprobanteTerminos,
                  firmaDataUrl: firma && firmaMime ? `data:${firmaMime};base64,${firma}` : null,
                  equipos: receiptEquipos,
                }}
              />
            </div>
            <Button
              variant="outline"
              className="flex-1 min-w-[140px]"
              onClick={handlePrintLabels}
              disabled={printingLabels}
            >
              {printingLabels ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Tag className="mr-2 h-4 w-4" />
              )}
              Etiquetas ({resultado.ordenes.length})
            </Button>
          </div>

          <div>
            <Label className="flex items-center gap-2 mb-2">
              <WhatsAppIcon className="h-4 w-4 text-green-600" />
              Mensaje para WhatsApp
            </Label>
            <Textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
          </div>

          <Button onClick={handleOpenWhatsApp} className="w-full bg-green-600 hover:bg-green-700">
            <WhatsAppIcon className="mr-2 h-4 w-4" />
            Abrir WhatsApp
            <ExternalLink className="ml-1 h-3 w-3" />
          </Button>

          <Button variant="ghost" onClick={handleClose} className="w-full">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
