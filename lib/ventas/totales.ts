/**
 * Totales de una venta: una sola implementación para el POS (navegador) y para
 * POST /api/ventas. No importa nada de servidor.
 *
 * Antes cada lado tenía su fórmula y aplicaban el recargo por método de pago en
 * distinto orden: el POS hacía (precios − descuentos) × factor y el server
 * precios × factor − descuentos. Con un descuento en monto fijo no coincidían:
 * $10.000 con $1.000 de descuento y tarjeta +10% → el POS cobraba $9.900 y el
 * server esperaba $10.000 y rechazaba la venta (o, si era fiada, cargaba $100
 * de más en la cuenta del cliente). También divergían por centavos.
 *
 * Reglas:
 * - El recargo del método se aplica al precio unitario (redondeado a centavos;
 *   es el precio que se guarda en items_venta) y los descuentos en monto se
 *   escalan igual. Así el recargo cae sobre el precio ya descontado, que es lo
 *   que el cajero le dice al cliente.
 * - Orden: descuento por línea → descuento global sobre el neto → IVA según
 *   régimen → redondeo de efectivo.
 * - El método que fija el recargo y si el cobro es en efectivo se deciden sobre
 *   los pagos que se cobran en el momento (monto > 0), los mismos que viajan en
 *   el payload.
 */

export type TipoDescuento = "MONTO" | "PORCENTAJE"
export type IvaRegimen = "EXENTO" | "INCLUIDO" | "ADITIVO"

export interface FiscalConfig {
  regimen: IvaRegimen
  tasa: number // p.ej. 21
  /** Unidad de redondeo de efectivo (0 = sin redondeo). */
  redondeoEfectivo: number
}

export interface DescuentoConfig {
  tipo: TipoDescuento
  valor: number
}

export interface LineaVenta {
  cantidad: number
  /** Precio de lista (sin recargo del método). */
  precioUnitario: number
  tipoDescuento?: TipoDescuento
  /** MONTO: $ off de la línea, a precio de lista. */
  descuento?: number
  /** PORCENTAJE: % sobre el bruto de la línea. */
  porcentajeDescuento?: number
}

export interface VentaTotales {
  subtotal: number // bruto (Σ cantidad×precio)
  descuentoItems: number
  descuentoGlobal: number
  descuentoTotal: number
  /** Base post-descuento, pre-IVA y pre-redondeo (= subtotal − descuentoTotal). */
  base: number
  /** Neto sin IVA. EXENTO/ADITIVO: = base. INCLUIDO: base/(1+tasa). */
  neto: number
  iva: number
  /** Ajuste por redondeo de efectivo (0 si no aplica). */
  redondeo: number
  /** Total final cobrado (con IVA aditivo + redondeo aplicados). */
  total: number
}

export interface PagoMonto {
  metodo: string
  monto: number
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Factor multiplicador del precio para un método: 1 + %/100. Sin config => 1. */
export function factorRecargo(recargos: Record<string, number>, metodo: string): number {
  return 1 + (recargos[metodo] ?? 0) / 100
}

/**
 * Método que fija el precio de la venta: el pago de mayor monto (empate => el
 * primero). Sin pagos => el fallback.
 */
export function metodoCondicion(pagos: PagoMonto[] | undefined | null, fallback: string): string {
  if (!pagos || pagos.length === 0) return fallback
  let elegido = pagos[0]
  for (const p of pagos) {
    if (p.monto > elegido.monto) elegido = p
  }
  return elegido.metodo
}

/** Pagos que se cobran en el momento: los de monto mayor a cero. */
export function pagosCobrados<T extends PagoMonto>(pagos: T[] | undefined | null): T[] {
  return (pagos ?? []).filter((p) => p.monto > 0)
}

/**
 * El redondeo de efectivo aplica solo si todo lo que se cobra ahora es
 * efectivo. Sin pagos (venta fiada) no hay vuelto que redondear.
 */
export function esCobroEnEfectivo(pagos: PagoMonto[]): boolean {
  return pagos.length > 0 && pagos.every((p) => p.metodo === "EFECTIVO")
}

/**
 * metodo_pago de la cabecera de la venta: el primer pago cobrado. Una venta
 * fiada (a pagar después, sin cobro ahora) queda como CUENTA_CORRIENTE: antes
 * quedaba "EFECTIVO" y así salía en el ticket y en los reportes por método.
 */
export function metodoPagoCabecera(pagos: PagoMonto[] | undefined | null, parcial = false): string {
  const primero = pagosCobrados(pagos)[0]?.metodo
  if (primero) return primero
  return parcial ? "CUENTA_CORRIENTE" : "EFECTIVO"
}

/**
 * Pagos que deciden el precio. Son los que se cobran ahora; si no viene
 * ninguno, una venta que no es a pagar después es el pago total con
 * `metodoPago` (camino viejo, sin array de pagos) y una fiada no cobra nada.
 */
function pagosDeCondicion(
  pagos: PagoMonto[] | undefined | null,
  metodoPago: string,
  parcial: boolean
): PagoMonto[] {
  const cobrados = pagosCobrados(pagos)
  if (cobrados.length > 0) return cobrados
  return parcial ? [] : [{ metodo: metodoPago, monto: 0 }]
}

export interface CondicionCobro {
  /** Método que fija el recargo (el pago de mayor monto). */
  metodo: string
  /** Porcentaje de recargo de ese método (0 si no tiene). */
  porcentaje: number
  factor: number
  /** Si corresponde el redondeo de efectivo. */
  efectivo: boolean
}

/**
 * Recargo y redondeo que corresponden a un cobro. El POS y el servidor lo
 * calculan con los mismos datos que viajan en el payload: los pagos, el
 * metodoPago de la cabecera y si es a pagar después.
 */
export function condicionDeCobro(
  pagos: PagoMonto[] | undefined | null,
  metodoPago: string,
  parcial: boolean,
  recargos: Record<string, number>
): CondicionCobro {
  const base = pagosDeCondicion(pagos, metodoPago, parcial)
  // Venta fiada: no se cobra nada ahora, va a precio de lista
  if (base.length === 0) return { metodo: metodoPago, porcentaje: 0, factor: 1, efectivo: false }
  const metodo = metodoCondicion(base, metodoPago)
  return {
    metodo,
    porcentaje: recargos[metodo] ?? 0,
    factor: factorRecargo(recargos, metodo),
    efectivo: esCobroEnEfectivo(base),
  }
}

/** Precio unitario con el recargo del método: es el que se guarda en items_venta. */
export function precioConRecargo(precio: number, factor: number): number {
  return round2(precio * factor)
}

function descuentoLinea(l: LineaVenta, lineaBruto: number, factor: number): number {
  if (l.tipoDescuento === "PORCENTAJE") {
    return lineaBruto * ((l.porcentajeDescuento || 0) / 100)
  }
  return Math.min(round2((l.descuento || 0) * factor), lineaBruto)
}

/**
 * Precio y descuento de la línea tal como se guardan en items_venta: con el
 * recargo aplicado, para que la línea sume lo mismo que el total de la venta
 * (las devoluciones calculan el reintegro desde estos valores).
 */
export function lineaConRecargo(l: LineaVenta, factor: number): { precioUnitario: number; descuento: number } {
  const precioUnitario = precioConRecargo(l.precioUnitario, factor)
  if (l.tipoDescuento === "PORCENTAJE") return { precioUnitario, descuento: 0 }
  return { precioUnitario, descuento: round2(descuentoLinea(l, l.cantidad * precioUnitario, factor)) }
}

export function calcularTotalesVenta(
  lineas: LineaVenta[],
  global?: DescuentoConfig | null,
  fiscal?: FiscalConfig | null,
  roundCash = false,
  factor = 1
): VentaTotales {
  let subtotalBruto = 0
  let descuentoItems = 0
  for (const l of lineas) {
    const lineaBruto = l.cantidad * precioConRecargo(l.precioUnitario, factor)
    subtotalBruto += lineaBruto
    descuentoItems += descuentoLinea(l, lineaBruto, factor)
  }
  const subtotalNeto = subtotalBruto - descuentoItems

  let descuentoGlobal = 0
  if (global && global.valor > 0) {
    descuentoGlobal =
      global.tipo === "PORCENTAJE"
        ? subtotalNeto * (global.valor / 100)
        : round2(global.valor * factor)
  }
  descuentoGlobal = Math.min(Math.max(descuentoGlobal, 0), subtotalNeto)

  const base = round2(Math.max(subtotalBruto - descuentoItems - descuentoGlobal, 0))

  const regimen = fiscal?.regimen ?? "EXENTO"
  const tasa = fiscal?.tasa ?? 0
  let neto = base
  let iva = 0
  let totalPreRound = base
  if (regimen === "INCLUIDO" && tasa > 0) {
    neto = round2(base / (1 + tasa / 100))
    iva = round2(base - neto)
    totalPreRound = base
  } else if (regimen === "ADITIVO" && tasa > 0) {
    neto = base
    iva = round2(base * (tasa / 100))
    totalPreRound = round2(base + iva)
  }

  let redondeo = 0
  let total = totalPreRound
  const unidad = fiscal?.redondeoEfectivo ?? 0
  if (roundCash && unidad > 0) {
    const rounded = Math.round(totalPreRound / unidad) * unidad
    redondeo = round2(rounded - totalPreRound)
    total = round2(rounded)
  }

  return {
    subtotal: round2(subtotalBruto),
    descuentoItems: round2(descuentoItems),
    descuentoGlobal: round2(descuentoGlobal),
    descuentoTotal: round2(descuentoItems + descuentoGlobal),
    base,
    neto: round2(neto),
    iva: round2(iva),
    redondeo,
    total: round2(total),
  }
}

/**
 * Concilia los pagos con el total antes de crear la venta. Los montos se
 * comparan al centavo: $2,86 + $11,45 da 14,309999… en binario y antes el
 * servidor lo tomaba como saldo pendiente de una venta de $14,31.
 * - Si cubren el total con una diferencia de hasta un centavo, se ajusta el
 *   pago más grande (evitando el de cuenta corriente, que descuenta saldo a
 *   favor) para que sumen exacto y el SQL no deje $0,01 de deuda.
 * - Si no lo cubren, solo vale como pago parcial; si lo superan, es un error.
 * - Sin pagos: una fiada deja todo pendiente; sin pago parcial es el camino
 *   viejo, en el que el SQL registra un único pago por el total.
 * Devuelve el saldo que queda pendiente, redondeado a centavos.
 */
export function conciliarPagos<T extends PagoMonto>(
  pagos: T[],
  total: number,
  parcial: boolean
): { pagos: T[]; saldoPendiente: number; error?: string } {
  if (pagos.length === 0) {
    return { pagos, saldoPendiente: parcial ? Math.max(round2(total), 0) : 0 }
  }

  const suma = round2(pagos.reduce((s, p) => s + p.monto, 0))
  const diferencia = round2(total - suma)

  if (Math.abs(diferencia) <= 0.01) {
    if (diferencia === 0) return { pagos, saldoPendiente: 0 }
    let idx = -1
    pagos.forEach((p, i) => {
      if (p.metodo === "CUENTA_CORRIENTE") return
      if (idx === -1 || p.monto > pagos[idx].monto) idx = i
    })
    if (idx === -1) {
      idx = 0
      pagos.forEach((p, i) => {
        if (p.monto > pagos[idx].monto) idx = i
      })
    }
    const ajustados = pagos.map((p, i) => (i === idx ? { ...p, monto: round2(p.monto + diferencia) } : p))
    return { pagos: ajustados, saldoPendiente: 0 }
  }

  if (diferencia < 0) {
    return {
      pagos,
      saldoPendiente: 0,
      error: parcial
        ? "El total de pagos no puede exceder el total de la venta."
        : "El total de pagos no coincide con el total de la venta.",
    }
  }
  if (!parcial) {
    return { pagos, saldoPendiente: diferencia, error: "El total de pagos no coincide con el total de la venta." }
  }
  return { pagos, saldoPendiente: diferencia }
}

/**
 * Descuento global de una venta guardada. venta.descuento es el TOTAL de
 * descuentos (líneas + global): el global en monto es lo que queda después de
 * restar los descuentos por línea. Pasarlo entero como global (lo que hacía la
 * edición) descontaba dos veces los de línea.
 */
export function descuentoGlobalDeVenta(venta: {
  descuento: number
  tipoDescuento?: TipoDescuento | null
  porcentajeDescuento?: number | null
  items: LineaVenta[]
}): DescuentoConfig | null {
  if (venta.tipoDescuento === "PORCENTAJE") {
    const pct = venta.porcentajeDescuento || 0
    return pct > 0 ? { tipo: "PORCENTAJE", valor: pct } : null
  }
  const deLineas = calcularTotalesVenta(venta.items).descuentoItems
  const global = Math.max(round2((venta.descuento || 0) - deLineas), 0)
  return global > 0 ? { tipo: "MONTO", valor: global } : null
}
