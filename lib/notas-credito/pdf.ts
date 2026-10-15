import { NextResponse } from "next/server"
import { generateNotaCreditoPDF, type NotaCreditoPDFData } from "@/lib/nota-credito-react-pdf"
import { etiquetaMotivo, etiquetaReintegro } from "./catalogo"
import type { NotaCreditoDocumento } from "./documento"

/** Del documento (datos) al PDF (palabras para el cliente). */
export function notaCreditoPdfData(doc: NotaCreditoDocumento): NotaCreditoPDFData {
  return {
    ...doc.emisor,
    cliente: doc.cliente,
    sucursalNombre: doc.sucursalNombre,
    atendidoPor: doc.atendidoPor,
    numero: doc.numero,
    fecha: doc.fecha,
    origen: doc.origen,
    operacion: doc.origenNumero,
    motivo: etiquetaMotivo(doc.motivoNc, doc.detalle),
    detalle: doc.detalle,
    observaciones: doc.observaciones,
    items: doc.items,
    monto: doc.monto,
    montoAplicadoDeuda: doc.montoAplicadoDeuda,
    montoReembolso: doc.montoReembolso,
    etiquetaReintegro: etiquetaReintegro(doc.metodo),
    pendienteActual: doc.pendienteActual,
    anulada: doc.anulada,
    anuladaAt: doc.anuladaAt,
    anuladaMotivo: doc.anuladaMotivo,
  }
}

/**
 * La respuesta HTTP del PDF, igual para las dos rutas que lo sirven. Sin
 * cache: el estado (ANULADA) y el saldo pendiente impreso cambian después.
 */
export async function respuestaPdfNotaCredito(doc: NotaCreditoDocumento): Promise<NextResponse> {
  const pdf = await generateNotaCreditoPDF(notaCreditoPdfData(doc))
  const archivo = doc.numero.replace(/[^A-Za-z0-9-]/g, "") || "nota-credito"
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="nota-credito-${archivo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  })
}
