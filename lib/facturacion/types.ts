// `IVoucher` no se re-exporta limpio desde la raíz del paquete; se importa por
// ruta interna como `INextVoucher` (ver arca/voucher.ts). Solo tipos: se borra al
// compilar, así que este módulo sigue siendo importable desde el cliente.
import type { IVoucher } from "@arcasdk/core/lib/domain/types/voucher.types"

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
  /**
   * Las líneas llegan con el IVA incluido y ya descontadas: suman `total`
   * (lo que pagó el cliente). `importe` es el total de la línea al centavo;
   * `importeUnitario` es `importe / cantidad` y puede tener más de 2 decimales.
   */
  items: Array<{
    cantidad: number
    descripcion: string
    importeUnitario: number
    /** Total de la línea, IVA incluido. Si falta, se usa importeUnitario x cantidad. */
    importe?: number
    alicuotaIva: number
  }>
  /** Total de la venta, el mismo que se cobró. Es el ImpTotal del comprobante. */
  total: number
  /**
   * Neto e IVA que la venta guardó (regímenes INCLUIDO y ADITIVO). Solo se
   * setea cuando suman exactamente `total`; si no, el IVA se despeja del total.
   */
  desgloseIva?: { neto: number; iva: number; alicuota: number }
}

/**
 * Foto fiscal del comprobante: lo que ARCA efectivamente autorizó. Se persiste
 * al emitir y es la única fuente del PDF y del QR (la venta puede editarse
 * después, el comprobante no).
 */
export interface DatosFiscales {
  /** YYYY-MM-DD, la fecha del comprobante (CbteFch). */
  fechaEmision: string
  /** CUIT del emisor, solo dígitos: el representado si la org delegó. */
  cuitEmisor: string
  /** Código ARCA del tipo de comprobante (B = 6, C = 11). */
  cbteTipo: number
  concepto: number
  /** Código de moneda ARCA ("PES"). */
  moneda: string
  cotizacion: number
  importeNeto: number
  importeIva: number
  importeTotal: number
  /** Código ARCA del tipo de documento del receptor (99 = consumidor final). */
  receptorDocTipoCod: number
  /** Número de documento del receptor, solo dígitos ("0" para consumidor final). */
  receptorDocNro: string
}

export interface ComprobanteResult {
  ok: boolean
  tipo: TipoComprobante
  numero?: string
  cae?: string
  caeVencimiento?: string
  pdfUrl?: string
  afipQr?: string
  /** Solo lo llena el proveedor ARCA directo. */
  fiscal?: DatosFiscales
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
  /** Dueño de la fila de credenciales — parte de la clave del ticket WSAA y del lease. */
  organizationId: string
  /**
   * CUIT del CERTIFICADO, es decir la identidad con la que se hace el login
   * WSAA. AFIP la deriva del subject del certificado, no del `Auth.Cuit`, así
   * que es esta —y no `cuitRepresentado`— la que keyea el cache del ticket.
   */
  cuit: string
  /**
   * Modelo de delegación: CUIT del contribuyente representado, el que va en
   * `Auth.Cuit` y figura como emisor del comprobante. Ausente en el modelo
   * BYO, donde el titular del certificado emite por sí mismo.
   */
  cuitRepresentado?: string
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

/**
 * Lo que ARCA devuelve al consultar un comprobante ya emitido (`FECompConsultar`).
 * Es la fuente AUTORITATIVA de los importes de una nota de crédito: las filas
 * legadas no guardan lo autorizado. El SDK descarta `Iva[]`, `CbtesAsoc` y
 * `CondicionIVAReceptorId`, así que la alícuota se infiere de `impIva`/`impNeto`.
 */
export interface ConsultaResult {
  /** `false` si ARCA no tiene ese comprobante. El resto de los campos queda vacío. */
  existe: boolean
  cae?: string
  caeVencimiento?: string
  /** "A" aprobado, "R" rechazado. */
  resultado?: string
  /** Fecha del comprobante en formato AAAAMMDD. */
  cbteFch?: string
  concepto?: number
  docTipo?: number
  /** Solo dígitos. */
  docNro?: string
  impTotal?: number
  impNeto?: number
  impIva?: number
  impTrib?: number
  impOpEx?: number
  impTotConc?: number
  moneda?: string
  cotizacion?: number
}

/** Motivo con el que el Admin anula una factura (queda en la nota de crédito). */
export type MotivoNotaCredito = "error_factura" | "devolucion_total" | "otro"

/**
 * Desenlace de enviar una nota de crédito a ARCA. `emitirNotaCredito` nunca
 * lanza: la distinción entre `rechazada` e `incierta` es la que evita emitir una
 * SEGUNDA nota de crédito al reintentar.
 *
 *  - `autorizada`: ARCA devolvió CAE.
 *  - `rechazada`: ARCA dijo "R"/Errors, o el envío falló ANTES de salir
 *    (autenticación, armado): ARCA no emitió nada, reintentar es seguro.
 *  - `incierta`: `createVoucher` lanzó, o respondió sin CAE y sin rechazo: ARCA
 *    pudo haberla emitido. Nunca se marca como rechazada; se verifica contra ARCA.
 */
export type ResultadoNotaCredito =
  | { kind: "autorizada"; numero: string; cae: string; caeVencimiento: string; raw: unknown }
  | { kind: "rechazada"; errores: string[]; raw: unknown }
  | { kind: "incierta"; error: string }

// Interfaces segregadas (ISP): cada capacidad ARCA-only es su propia interfaz,
// nunca un método opcional en `FacturacionProvider` — evita forzar a
// tusfacturas-provider.ts a implementar NC/consulta/puntos de venta, que no
// soporta, y evita el guard-en-cada-call-site de una interfaz "fat" opcional.
export interface SoportaNotaCredito<C> {
  /** Envía el voucher ya armado y numerado (`CbteDesde`/`CbteHasta` explícitos). */
  emitirNotaCredito(creds: C, voucher: IVoucher): Promise<ResultadoNotaCredito>
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
