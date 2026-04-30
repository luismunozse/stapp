"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Printer, Loader2, Usb } from "lucide-react"
import { useThermalPrinter } from "@/components/pos/use-thermal-printer"
import { generateOrdenTicketCommands, type OrdenTicketData } from "@/lib/escpos"
import { imageUrlToRaster } from "@/lib/escpos-image"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"
import { toast } from "sonner"
import type { OrdenServicio } from "@/types"

interface ThermalPrintOrdenProps {
  orden: OrdenServicio & {
    organizations?: {
      nombre?: string | null
      nombre_mostrar?: string | null
      logo_url?: string | null
      telefono?: string | null
      direccion?: string | null
    } | null
  }
}

export function ThermalPrintOrden({ orden }: ThermalPrintOrdenProps) {
  const { connected, connecting, isSupported, connect, print } = useThermalPrinter()
  const [printing, setPrinting] = useState(false)

  if (!isSupported) return null

  const buildTicketData = async (): Promise<OrdenTicketData> => {
    const org = orden.organizations
    const nombreEmpresa = org?.nombre_mostrar || org?.nombre || undefined

    let logoRaster: Uint8Array | null = null
    if (org?.logo_url) {
      logoRaster = await imageUrlToRaster(org.logo_url, { maxWidth: 280 })
    }

    return {
      numeroOrden: orden.numeroOrden,
      codigoOrden: orden.codigoOrden,
      fechaIngreso: orden.fechaIngreso
        ? new Date(orden.fechaIngreso).toLocaleDateString("es-AR", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          })
        : "",
      estado: ESTADO_LABELS[orden.estado] || orden.estado,
      cliente: {
        nombre: orden.cliente?.nombre || "",
        telefono: orden.telefonoContacto || orden.cliente?.telefono || null,
      },
      dispositivo: orden.dispositivo,
      marca: orden.marca,
      color: orden.color,
      imei: orden.imei,
      accesorios: orden.accesorios,
      problemaReportado: orden.problemaReportado,
      presupuesto: orden.presupuesto ?? null,
      costoFinal: orden.costoFinal ?? null,
      fechaPrometida: orden.fechaPrometida
        ? new Date(orden.fechaPrometida).toLocaleDateString("es-AR")
        : null,
      observaciones: orden.observaciones ?? null,
      nombreEmpresa,
      telefonoEmpresa: org?.telefono ?? null,
      direccionEmpresa: org?.direccion ?? null,
      logoRaster,
    }
  }

  const handlePrint = async () => {
    if (!connected) {
      await connect()
      return
    }
    setPrinting(true)
    try {
      const ticketData = await buildTicketData()
      const commands = generateOrdenTicketCommands(ticketData, 80)
      const ok = await print(commands)
      if (ok) {
        toast.success("Comprobante impreso")
      } else {
        toast.error("Error al imprimir")
      }
    } catch {
      toast.error("Error al imprimir comprobante")
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handlePrint}
      disabled={connecting || printing}
      title={connected ? "Imprimir comprobante térmico" : "Conectar impresora térmica"}
    >
      {connecting || printing ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : connected ? (
        <Printer className="h-4 w-4 mr-2" />
      ) : (
        <Usb className="h-4 w-4 mr-2" />
      )}
      {connecting ? "Conectando..." : printing ? "Imprimiendo..." : connected ? "Térmica" : "Térmica"}
    </Button>
  )
}
