import type { FacturacionProvider, FacturacionCredenciales, EmitirInput, ComprobanteResult, TipoComprobante } from "./types"
import { deriveTipo } from "./derive"

const ENDPOINT = "https://www.tusfacturas.app/app/api/v2/facturacion/nuevo"
// AFIP IVA scheme codes by rate (confirm against spike output).
const AFIP_SCHEME: Record<number, string> = { 0: "03", 10.5: "04", 21: "05", 27: "06" }

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function buildPayload(creds: FacturacionCredenciales, input: EmitirInput, tipo: TipoComprobante) {
  const hoy = ddmmyyyy(new Date())
  return {
    apitoken: creds.apitoken, apikey: creds.apikey, usertoken: creds.usertoken,
    cliente: {
      documento_tipo: input.receptor.documentoTipo, documento_nro: input.receptor.documentoNro,
      razon_social: input.receptor.razonSocial, email: input.receptor.email ?? "",
      domicilio: input.receptor.domicilio ?? "", condicion_iva: input.receptor.condicionIva, condicion_pago: "0",
    },
    comprobante: {
      rubro: "Servicios", tipo: tipo === "C" ? "FACTURA C" : "FACTURA B", operacion: "V",
      external_reference: input.ventaId, punto_venta: String(creds.puntoVenta),
      fecha: hoy, vencimiento: hoy, moneda: input.moneda, cotizacion: "1",
      detalle: input.items.map((it) => ({
        cantidad: String(it.cantidad),
        afip_scheme: AFIP_SCHEME[it.alicuotaIva] ?? "05",
        alicuota: String(it.alicuotaIva),
        importe: (Math.round(it.importeUnitario * it.cantidad * 100) / 100).toFixed(2),
        producto: { descripcion: it.descripcion, unidad_bulto: "1", precio_unitario_sin_iva: (Math.round(it.importeUnitario * 100) / 100).toFixed(2) },
      })),
      leyenda_gral: "",
    },
  }
}

export const tusFacturasProvider: FacturacionProvider = {
  async emitir(creds, input): Promise<ComprobanteResult> {
    const tipo = deriveTipo(creds.condicionFiscal)
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(creds, input, tipo)),
      })
      const data: any = await res.json()
      if (data?.error === "N") {
        return {
          ok: true, tipo, numero: data.comprobante_nro, cae: data.cae,
          caeVencimiento: data.vencimiento_cae, pdfUrl: data.comprobante_pdf_url,
          afipQr: data.afip_qr, raw: data,
        }
      }
      return { ok: false, tipo, errores: data?.errores ?? ["Error desconocido del proveedor"], raw: data }
    } catch (e: any) {
      return { ok: false, tipo, errores: [e?.message ?? "Fallo de red"], raw: null }
    }
  },
}
