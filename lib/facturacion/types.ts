export type CondicionFiscalEmisor = "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO"
export type TipoComprobante = "B" | "C"

export interface FacturacionCredenciales {
  apitoken: string
  apikey: string
  usertoken: string
  puntoVenta: number
  condicionFiscal: CondicionFiscalEmisor
}

export interface EmitirInput {
  ventaId: string
  receptor: {
    razonSocial: string
    documentoTipo: string
    documentoNro: string
    condicionIva: string
    email?: string
    domicilio?: string
  }
  moneda: string
  items: Array<{
    cantidad: number
    descripcion: string
    importeUnitario: number
    alicuotaIva: number
  }>
  total: number
}

export interface ComprobanteResult {
  ok: boolean
  tipo: TipoComprobante
  numero?: string
  cae?: string
  caeVencimiento?: string
  pdfUrl?: string
  afipQr?: string
  errores?: string[]
  raw: unknown
}

export interface FacturacionProvider {
  emitir(creds: FacturacionCredenciales, input: EmitirInput): Promise<ComprobanteResult>
}
