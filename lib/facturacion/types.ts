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

// Generic con default = FacturacionCredenciales: tusfacturas-provider.ts declara
// `FacturacionProvider` sin parámetro y sigue resolviendo exactamente al mismo
// tipo (design ADR-01) — zero-diff garantizado por el default, no por una unión.
export interface FacturacionProvider<C = FacturacionCredenciales> {
  emitir(creds: C, input: EmitirInput): Promise<ComprobanteResult>
}

// ============================================================================
// ARCA directo (design ADR-01) — credenciales y capacidades segregadas.
// `ArcaCredenciales` es un tipo hermano de `FacturacionCredenciales`, nunca un
// miembro de una unión: `buildPayload()` en tusfacturas-provider.ts lee
// `creds.apitoken` sin narrowing, así que una unión rompería la compilación.
// ============================================================================

export interface ArcaCredenciales {
  cuit: string
  certPem: string
  keyPem: string
  puntoVenta: number
  condicionFiscal: CondicionFiscalEmisor
  production: boolean
}

export interface PuntoVenta {
  numero: number
  bloqueado: boolean
}

export interface DiagnosticoResult {
  ok: boolean
  puntosVenta?: PuntoVenta[]
  error?: string
}

export interface ComprobanteRef {
  puntoVenta: number
  cbteTipoAfip: number
  cbteNro: number
}

export interface ConsultaResult {
  existe: boolean
  cae?: string
  caeVencimiento?: string
  total?: number
  cbteFch?: string
  docNro?: string
}

export type MotivoNotaCredito = "error_datos" | "error_importe" | "anulacion_venta" | "devolucion" | "duplicado" | "otro"

export interface NotaCreditoInput extends EmitirInput {
  comprobanteAsociadoId: string
  motivo: MotivoNotaCredito
  motivoDetalle?: string
}

// Interfaces segregadas (ISP): cada capacidad ARCA-only es su propia interfaz,
// nunca un método opcional en `FacturacionProvider` — evita forzar a
// tusfacturas-provider.ts a implementar NC/consulta/puntos de venta, que no
// soporta, y evita el guard-en-cada-call-site de una interfaz "fat" opcional.
export interface SoportaNotaCredito<C> {
  emitirNotaCredito(creds: C, input: NotaCreditoInput): Promise<ComprobanteResult>
}

export interface SoportaConsulta<C> {
  consultar(creds: C, ref: ComprobanteRef): Promise<ConsultaResult>
}

export interface SoportaUltimoNumero<C> {
  ultimoAutorizado(creds: C, pv: number, cbteTipo: number): Promise<number>
}

export interface SoportaPuntosVenta<C> {
  listarPuntosVenta(creds: C): Promise<PuntoVenta[]>
}

export interface SoportaDiagnostico<C> {
  probarConexion(creds: C): Promise<DiagnosticoResult>
}
