import { formatCurrencyValue, DEFAULT_CURRENCY, type CurrencyCode } from "@/lib/currency"
import { resolvePlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { generateWhatsAppUrl } from "@/lib/notifications/whatsapp-templates"
import { CONSUMIDOR_FINAL, etiquetaReintegro } from "./catalogo"
import type { NotaCreditoDocumento } from "./documento"

/**
 * Texto que acompaña el PDF de una NC por WhatsApp: la plantilla
 * `nota_credito_comprobante` del taller o la de STApp. Sin link: el PDF viaja
 * como archivo, porque /api/notas-credito/[id]/pdf exige sesión y el cliente
 * no la tiene.
 */
export function mensajeNotaCredito(doc: NotaCreditoDocumento, plantillas?: Record<string, string> | null): string {
  const moneda = (doc.emisor.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const plata = (n: number) => formatCurrencyValue(n, moneda)
  const importes = [
    doc.montoAplicadoDeuda > 0 ? `Descontado de tu saldo pendiente: ${plata(doc.montoAplicadoDeuda)}` : null,
    doc.montoReembolso > 0 ? `${etiquetaReintegro(doc.metodo)}: ${plata(doc.montoReembolso)}` : null,
  ].filter((l): l is string => l !== null)

  const cliente = doc.cliente.nombre === CONSUMIDOR_FINAL ? "" : doc.cliente.nombre

  return resolvePlantilla(
    "nota_credito_comprobante",
    {
      cliente,
      numero_nc: doc.numero,
      operacion: `${doc.origen === "VENTA" ? "compra" : "orden"} ${doc.origenNumero}`,
      monto: plata(doc.monto),
      detalle_importes: importes.length > 0 ? `\n\n${importes.join("\n")}` : "",
      empresa: doc.emisor.nombreEmpresa ?? "",
    },
    plantillas ?? null
  ).replace(/^Hola ,/, "Hola,")
}

export type ResultadoCompartir = "compartido" | "whatsapp" | "descargado"

/**
 * Comparte el PDF de una NC. En el celular, la hoja de compartir del sistema
 * (el taller elige el chat: no hace falta el teléfono). En la compu, descarga
 * el PDF y abre WhatsApp con el texto para que lo adjunte; sin teléfono, solo
 * descarga. Mismo camino que el ticket del POS (components/pos/pos-ticket-share.tsx).
 */
export async function compartirNotaCredito(opts: {
  id: string
  numero: string
  telefono: string | null
  pais: string | null
  mensaje: string
}): Promise<ResultadoCompartir> {
  const res = await fetch(`/api/notas-credito/${encodeURIComponent(opts.id)}/pdf`)
  if (!res.ok) throw new Error("No se pudo generar el PDF")
  const blob = await res.blob()
  const nombre = `nota-credito-${opts.numero.replace(/[^A-Za-z0-9-]/g, "")}.pdf`
  const archivo = new File([blob], nombre, { type: "application/pdf" })

  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [archivo] })) {
    await navigator.share({ text: opts.mensaje, files: [archivo] })
    return "compartido"
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  if (!opts.telefono) return "descargado"
  window.open(generateWhatsAppUrl(opts.telefono, opts.mensaje, opts.pais), "_blank")
  return "whatsapp"
}
