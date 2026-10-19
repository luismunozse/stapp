/**
 * Anular una nota de crédito de venta, del lado de la pantalla. La regla la
 * decide la base (anular_devolucion_venta, migración 369); esto la anticipa
 * para no ofrecer un botón que va a rebotar, y cuenta qué se revierte con las
 * palabras del taller. Stock y series los sabe solo la base: si no alcanzan,
 * el diálogo muestra su mensaje.
 */
import { etiquetaMetodo } from "./catalogo"

export interface NotaCreditoAnulable {
  id: string
  numeroDevolucion: string
  createdAt: string
  anulada?: boolean
}

/**
 * La NC activa más reciente: la única que se puede anular (spec, "Anulación": LIFO).
 * Se ordena solo por número, con comparación de texto (orden de bytes, como
 * COLLATE "C" en la base): el número crece con cada emisión y no depende de la
 * fecha. Las DEV- no se anulan, así que nunca cuentan como "la más reciente".
 */
export function ultimaActiva<T extends NotaCreditoAnulable>(ncs: readonly T[]): T | null {
  let ultima: T | null = null
  for (const nc of ncs) {
    if (nc.anulada || !nc.numeroDevolucion.startsWith("NC-")) continue
    if (!ultima || nc.numeroDevolucion > ultima.numeroDevolucion) ultima = nc
  }
  return ultima
}

/** Por qué no se puede anular esta NC (mismo orden que la 369), o null si se puede. */
export function bloqueoAnulacionNC(
  nc: NotaCreditoAnulable,
  todas: readonly NotaCreditoAnulable[],
  estadoVenta: string
): string | null {
  if (nc.anulada) return "Ya está anulada."
  if (estadoVenta === "ANULADA") return "La venta está anulada: sus notas de crédito ya no se pueden anular."
  if (!nc.numeroDevolucion.startsWith("NC-")) {
    return "Las devoluciones anteriores a las notas de crédito (DEV-) no se pueden anular."
  }
  const ultima = ultimaActiva(todas)
  if (ultima && ultima.id !== nc.id) {
    return `Se anulan de la más reciente a la primera: primero anulá la ${ultima.numeroDevolucion}.`
  }
  return null
}

export interface NotaCreditoParaReversa {
  montoAplicadoDeuda: number
  montoReembolso: number
  metodoReembolso: string | null
  items: ReadonlyArray<{ descripcion: string; cantidad: number; restaurarStock: boolean }>
}

export interface ContextoReversa {
  /** Formatea con la moneda del taller (useCurrency().formatPrice). */
  formatPrice: (monto: number) => string
  /** La venta tiene cliente: lo que bajó la deuda se había acreditado en su cuenta corriente. */
  tieneCliente: boolean
  /** Saldo actual de su cuenta corriente (positivo = a favor), si se conoce. */
  saldoCliente: number | null
}

/** Qué deshace la anulación, en el orden en que lo lee el taller (spec, UI: "muestra qué se revierte"). */
export function reversaDeNotaCredito(nc: NotaCreditoParaReversa, ctx: ContextoReversa): string[] {
  const { formatPrice } = ctx
  const lineas: string[] = []

  const repuestos = nc.items.filter((i) => i.restaurarStock)
  if (repuestos.length > 0) {
    lineas.push(`Vuelven a salir del stock: ${repuestos.map((i) => `${i.cantidad} × ${i.descripcion}`).join(", ")}.`)
  }
  if (nc.items.length > 0) {
    lineas.push("Los productos devueltos vuelven a quedar vendidos al cliente, con su número de serie y su garantía si tenían.")
  }
  if (nc.montoAplicadoDeuda > 0) {
    lineas.push(`La deuda de la venta vuelve a subir ${formatPrice(nc.montoAplicadoDeuda)}.`)
  }
  if (nc.montoReembolso > 0 && nc.metodoReembolso && nc.metodoReembolso !== "CUENTA_CORRIENTE") {
    if (nc.metodoReembolso === "EFECTIVO") {
      lineas.push(`Vuelven a entrar a la caja ${formatPrice(nc.montoReembolso)} en efectivo: el cliente devuelve lo que se le dio.`)
    } else {
      const medio = (etiquetaMetodo(nc.metodoReembolso) ?? "otro medio").toLowerCase()
      lineas.push(
        `Se le devolvieron ${formatPrice(nc.montoReembolso)} por ${medio}: el sistema no mueve esa plata; si corresponde, recuperala por fuera.`
      )
    }
  }

  // Lo que la NC había acreditado en la cuenta corriente vuelve como cargo (369).
  const cargo =
    (ctx.tieneCliente ? nc.montoAplicadoDeuda : 0) +
    (nc.metodoReembolso === "CUENTA_CORRIENTE" ? nc.montoReembolso : 0)
  if (cargo > 0) {
    if (ctx.saldoCliente === null) {
      lineas.push(`Se le cargan ${formatPrice(cargo)} en la cuenta corriente.`)
    } else {
      const despues = Math.round((ctx.saldoCliente - cargo) * 100) / 100
      lineas.push(
        `Se le cargan ${formatPrice(cargo)} en la cuenta corriente: el saldo pasa de ${formatPrice(ctx.saldoCliente)} a ${formatPrice(despues)}` +
          (despues < 0 ? " (queda debiendo)." : ".")
      )
    }
  }

  lineas.push("La nota de crédito queda anulada: se sigue viendo con su número y el PDF sale con el sello ANULADA.")
  return lineas
}
