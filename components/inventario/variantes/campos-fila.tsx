"use client"

import { useState, type Dispatch, type KeyboardEvent, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { QuickStockAdjust } from "@/components/inventario/quick-stock-adjust"
import { parseMoneyInput } from "@/lib/parse-money"
import { bloqueos, type CambiosDeFila, type Fila, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import { describirEfecto, efectoDeDeshacer } from "./vista"

/*
 * The fields of ONE combination, shared by the table (desktop) and the card (phone) so both say and do
 * the same. Each field is controlled by the reducer state; the numeric ones edit a local draft and commit
 * on blur or Enter, so a half-typed number ("1.", "-") is never refused key by key. A refused commit
 * leaves the state alone and the field shows the saved value again; the reason is `estado.aviso`.
 */

export interface PropsDeFila {
  estado: VariantesState
  fila: Fila
  /** "Rojo / M": names every control for assistive technology. */
  etiqueta: string
  dispatch: Dispatch<VariantesAccion>
  /** Table cells are shorter than the phone's 44px fields. */
  compacto?: boolean
  deshabilitado?: boolean
}

export const unidades = (n: number) => (n === 1 ? "1 unidad" : `${n} unidades`)

const alto = (compacto?: boolean) => (compacto ? "h-9" : "h-11")

/** A text field with a draft: Enter or blur commits it, Escape drops it, and Enter never submits the product form. */
function Editable({
  valor,
  etiqueta,
  placeholder,
  alConfirmar,
  deshabilitado,
  className,
  inputMode,
}: {
  valor: string
  etiqueta: string
  placeholder?: string
  alConfirmar: (texto: string) => void
  deshabilitado?: boolean
  className?: string
  inputMode?: "decimal" | "numeric"
}) {
  const [borrador, setBorrador] = useState<string | null>(null)
  const confirmar = () => {
    if (borrador !== null && borrador !== valor) alConfirmar(borrador)
    setBorrador(null)
  }
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      confirmar()
    } else if (e.key === "Escape" && borrador !== null) {
      e.preventDefault()
      setBorrador(null)
    }
  }
  return (
    <Input
      type="text"
      inputMode={inputMode}
      aria-label={etiqueta}
      placeholder={placeholder}
      value={borrador ?? valor}
      disabled={deshabilitado}
      autoComplete="off"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={confirmar}
      onKeyDown={teclas}
      className={className}
    />
  )
}

const comoTexto = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n))

/** A price or a cost: read like the product form reads it ("1.500,50", "1500.5"); a blank is NaN, which the reducer refuses by name. */
function Monto(props: { valor: number | null; etiqueta: string; placeholder: string; alConfirmar: (n: number) => void; deshabilitado?: boolean; className: string }) {
  const { valor, alConfirmar, ...resto } = props
  return <Editable {...resto} valor={comoTexto(valor)} inputMode="decimal" alConfirmar={(texto) => alConfirmar(parseMoneyInput(texto))} />
}

/** A whole number. A blank is NaN (refused by name) unless `vacioEsNulo`, which sends null. */
function Entero(props: {
  valor: number | null
  etiqueta: string
  alConfirmar: (n: number | null) => void
  vacioEsNulo?: boolean
  deshabilitado?: boolean
  className: string
  placeholder?: string
}) {
  const { valor, alConfirmar, vacioEsNulo, ...resto } = props
  return (
    <Editable
      {...resto}
      valor={comoTexto(valor)}
      inputMode="numeric"
      alConfirmar={(texto) => {
        const limpio = texto.trim()
        alConfirmar(limpio === "" ? (vacioEsNulo ? null : NaN) : Number(limpio))
      }}
    />
  )
}

const editar = (dispatch: Dispatch<VariantesAccion>, fila: Fila, cambios: CambiosDeFila) => dispatch({ tipo: "editarFila", filaId: fila.id, cambios })

export function CampoCodigo({ fila, etiqueta, dispatch, compacto, deshabilitado }: PropsDeFila) {
  const conservado = fila.restaurada && !fila.codigoTocado
  return (
    <Input
      type="text"
      aria-label={`Código de ${etiqueta}`}
      placeholder={conservado ? "Se conserva" : "Código"}
      value={fila.codigo}
      disabled={deshabilitado}
      autoComplete="off"
      onChange={(e) => editar(dispatch, fila, { codigo: e.target.value })}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      className={alto(compacto)}
    />
  )
}

export function CampoPrecio({ fila, etiqueta, dispatch, compacto, deshabilitado }: PropsDeFila) {
  const conservado = fila.restaurada && !fila.precioTocado
  return (
    <Monto
      etiqueta={`Precio de ${etiqueta}`}
      placeholder={conservado ? "Se conserva" : "0.00"}
      valor={conservado ? null : fila.precioVenta}
      alConfirmar={(precioVenta) => editar(dispatch, fila, { precioVenta })}
      deshabilitado={deshabilitado}
      className={`${alto(compacto)} tabular-nums`}
    />
  )
}

/** Only rendered for a role with cost access (the caller checks `estado.costoCargado`). */
export function CampoCosto({ fila, etiqueta, dispatch, compacto, deshabilitado }: PropsDeFila) {
  const sinCosto = fila.precioCompra === undefined
  return (
    <Monto
      etiqueta={`Costo de ${etiqueta}`}
      placeholder={sinCosto && fila.restaurada ? "Se conserva" : "0.00"}
      valor={fila.precioCompra ?? null}
      alConfirmar={(precioCompra) => editar(dispatch, fila, { precioCompra })}
      deshabilitado={deshabilitado}
      className={`${alto(compacto)} tabular-nums`}
    />
  )
}

/**
 * New rows take an initial stock. A saved row's stock is only ever changed through the quick adjust (a
 * movement the history records), never by typing; a row brought back from the archive is not active yet,
 * so it is read-only until saved.
 */
export function CampoStock({
  fila,
  etiqueta,
  dispatch,
  compacto,
  deshabilitado,
  alAjustarStock,
}: PropsDeFila & { alAjustarStock?: () => void }) {
  if (!fila.existente) {
    return (
      <Entero
        etiqueta={`Stock inicial de ${etiqueta}`}
        valor={fila.stockInicial}
        alConfirmar={(n) => editar(dispatch, fila, { stockInicial: n as number })}
        deshabilitado={deshabilitado}
        className={`${alto(compacto)} tabular-nums`}
      />
    )
  }
  const stock = fila.stock ?? 0
  if (fila.restaurada) {
    return (
      <span className={`inline-flex items-center ${compacto ? "" : "min-h-11"} tabular-nums`} title="Se puede ajustar después de guardar">
        <span className="sr-only">Stock de {etiqueta}: </span>
        <span>{stock}</span>
      </span>
    )
  }
  return (
    <div className={`inline-flex items-center ${compacto ? "" : "min-h-11 [&_button]:min-h-11 [&_button]:min-w-11"} tabular-nums`}>
      <span className="sr-only">Stock de {etiqueta}: </span>
      <QuickStockAdjust
        itemId={fila.id}
        currentStock={stock}
        esStockBajo={fila.extra.stockMinimo !== null && stock <= fila.extra.stockMinimo}
        sinStock={stock === 0}
        onAdjusted={alAjustarStock ?? (() => {})}
      />
    </div>
  )
}

/** Barcode, stock limits and location: rarely touched, so they live behind "Más datos". */
export function CamposAvanzados({ fila, etiqueta, dispatch, compacto, deshabilitado }: PropsDeFila) {
  const clase = alto(compacto)
  const campo = (nombre: string, control: ReactNode) => (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {nombre}
      {control}
    </label>
  )
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {campo(
        "Código de barras",
        <Editable
          etiqueta={`Código de barras de ${etiqueta}`}
          valor={fila.barcode ?? ""}
          alConfirmar={(barcode) => editar(dispatch, fila, { barcode })}
          deshabilitado={deshabilitado}
          className={clase}
        />
      )}
      {campo(
        "Ubicación",
        <Editable
          etiqueta={`Ubicación de ${etiqueta}`}
          valor={fila.extra.ubicacion ?? ""}
          alConfirmar={(ubicacion) => editar(dispatch, fila, { ubicacion })}
          deshabilitado={deshabilitado}
          className={clase}
        />
      )}
      {campo(
        "Stock mínimo",
        <Entero
          etiqueta={`Stock mínimo de ${etiqueta}`}
          valor={fila.extra.stockMinimo}
          vacioEsNulo
          alConfirmar={(stockMinimo) => editar(dispatch, fila, { stockMinimo })}
          deshabilitado={deshabilitado}
          className={`${clase} tabular-nums`}
        />
      )}
      {campo(
        "Stock máximo",
        <Entero
          etiqueta={`Stock máximo de ${etiqueta}`}
          valor={fila.extra.stockMaximo}
          vacioEsNulo
          alConfirmar={(stockMaximo) => editar(dispatch, fila, { stockMaximo })}
          deshabilitado={deshabilitado}
          className={`${clase} tabular-nums`}
        />
      )}
      {campo(
        "Punto de reorden",
        <Entero
          etiqueta={`Punto de reorden de ${etiqueta}`}
          valor={fila.extra.puntoReorden}
          vacioEsNulo
          alConfirmar={(puntoReorden) => editar(dispatch, fila, { puntoReorden })}
          deshabilitado={deshabilitado}
          className={`${clase} tabular-nums`}
        />
      )}
    </div>
  )
}

/**
 * What a row pending archive shows instead of its fields: the mark, the stock it keeps, why an archive
 * is blocked, what the undo would also bring back (BEFORE pressing it) and the undo itself.
 */
export function BloqueDeArchivo({ estado, fila, etiqueta, dispatch, compacto, deshabilitado }: PropsDeFila) {
  const bloqueo = bloqueos(estado).find((b) => b.filaId === fila.id)
  const stock = fila.existente ? (fila.stock ?? 0) : 0
  const aviso = describirEfecto(efectoDeDeshacer(estado, fila))
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Se archivará</span>
      <button
        type="button"
        aria-label={`Deshacer archivo de ${etiqueta}`}
        disabled={deshabilitado}
        onClick={() => dispatch({ tipo: "deshacerArchivo", filaId: fila.id })}
        className={`${compacto ? "h-9" : "min-h-11"} rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none`}
      >
        Deshacer
      </button>
      {stock > 0 && !bloqueo && <span className="text-xs text-muted-foreground">Conserva {unidades(stock)}</span>}
      {bloqueo && <span className="basis-full text-xs font-medium text-destructive">{bloqueo.motivo}</span>}
      {aviso && <span className="basis-full text-xs text-muted-foreground">{aviso}</span>}
    </div>
  )
}
