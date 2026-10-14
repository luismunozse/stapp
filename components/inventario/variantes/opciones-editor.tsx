"use client"

import { useState, type Dispatch, type KeyboardEvent } from "react"
import { Plus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { LIMITES } from "@/lib/variantes-schema"
import { crearReductor, type OpcionDeEstado, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"

/*
 * Options and values of a product with variants, as editable chips.
 *
 * Deliberately NO motion: a value is added or removed from the keyboard many times in a row, so nothing here
 * animates or transitions (no `animate-*`, `transition*`, motion wrapper). The rows below the editor are the
 * ones that react to what is typed here.
 *
 * Every field that holds a TEXT the reducer validates (a value or an option name) edits a local draft and
 * commits on blur or Enter, never on each key: a half-typed name would otherwise be refused one key at a time.
 * A refused commit leaves the state alone, so the field shows the saved text again; the reason is the state's
 * `aviso`, which the section shows. Enter never submits the product form that contains this editor.
 */

interface Props {
  /** The whole state: a pasted list of values is tried against it first, to report every refusal. */
  estado: VariantesState
  dispatch: Dispatch<VariantesAccion>
  /** Locks every control (a save in flight). */
  deshabilitado?: boolean
}

const ENTRADA = "h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm"
const BOTON_ICONO = "inline-flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"

/** Splits "Verde, Negro" into its values; blanks are dropped. */
const partir = (texto: string) =>
  texto
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")

/** A text field that edits a draft and commits it on blur or Enter; Escape drops the draft. */
function TextoEditable({
  valor,
  etiqueta,
  alConfirmar,
  deshabilitado,
  className,
  ancho,
}: {
  valor: string
  etiqueta: string
  alConfirmar: (texto: string) => void
  deshabilitado?: boolean
  className?: string
  ancho?: boolean
}) {
  const [borrador, setBorrador] = useState<string | null>(null)
  const mostrado = borrador ?? valor
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
    <input
      type="text"
      aria-label={etiqueta}
      value={mostrado}
      disabled={deshabilitado}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={confirmar}
      onKeyDown={teclas}
      style={ancho ? { width: `${Math.max(mostrado.length, 3) + 2}ch`, maxWidth: "100%" } : undefined}
      className={className}
    />
  )
}

function AgregarValor({
  estado,
  opcion,
  dispatch,
  deshabilitado,
}: {
  estado: VariantesState
  opcion: OpcionDeEstado
  dispatch: Dispatch<VariantesAccion>
  deshabilitado?: boolean
}) {
  const [texto, setTexto] = useState("")
  const agregar = (crudo: string) => {
    const valores = partir(crudo)
    const accion = (valor: string): VariantesAccion => ({ tipo: "agregarValor", opcionId: opcion.id, texto: valor })
    if (valores.length <= 1) {
      for (const valor of valores) dispatch(accion(valor))
      return
    }
    // Several values at once: an accepted value clears the reason of a refused one before it, so the list is
    // tried here first (the reducer is pure) and every refusal is reported together.
    const reducir = crearReductor()
    let actual = estado
    const rechazos: string[] = []
    for (const valor of valores) {
      actual = reducir(actual, accion(valor))
      if (actual.aviso !== null) rechazos.push(`No se agregó "${valor}": ${actual.aviso}`)
    }
    if (rechazos.length === 0) for (const valor of valores) dispatch(accion(valor))
    else dispatch({ tipo: "reemplazar", estado: { ...actual, aviso: rechazos.join(" ") } })
  }
  return (
    <input
      type="text"
      aria-label={`Agregar valor a ${opcion.nombre}`}
      placeholder="Escribí un valor y apretá Enter"
      value={texto}
      disabled={deshabilitado}
      autoComplete="off"
      onChange={(e) => {
        const nuevo = e.target.value
        if (!nuevo.includes(",")) return setTexto(nuevo)
        // A comma closes every value before it; what follows the last one stays in the field.
        const cierres = nuevo.slice(0, nuevo.lastIndexOf(","))
        agregar(cierres)
        setTexto(nuevo.slice(nuevo.lastIndexOf(",") + 1).trimStart())
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return
        e.preventDefault()
        agregar(texto)
        setTexto("")
      }}
      onBlur={() => {
        if (texto.trim() === "") return
        agregar(texto)
        setTexto("")
      }}
      className={`${ENTRADA} min-w-[12rem] sm:max-w-xs`}
    />
  )
}

function FilaDeOpcion({
  estado,
  opcion,
  dispatch,
  deshabilitado,
}: {
  estado: VariantesState
  opcion: OpcionDeEstado
  dispatch: Dispatch<VariantesAccion>
  deshabilitado?: boolean
}) {
  return (
    <div role="group" aria-label={`Opción ${opcion.nombre}`} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <TextoEditable
          valor={opcion.nombre}
          etiqueta="Nombre de la opción"
          alConfirmar={(nombre) => dispatch({ tipo: "renombrarOpcion", opcionId: opcion.id, nombre })}
          deshabilitado={deshabilitado}
          className={`${ENTRADA} font-medium`}
        />
        <button
          type="button"
          aria-label={`Quitar la opción ${opcion.nombre}`}
          disabled={deshabilitado}
          onClick={() => dispatch({ tipo: "quitarOpcion", opcionId: opcion.id })}
          className={BOTON_ICONO}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <ul className="flex flex-wrap items-center gap-2">
        {opcion.valores.map((valor) => (
          <li key={valor.id} className="flex min-w-0 max-w-full items-center rounded-full border bg-background pl-3">
            <TextoEditable
              valor={valor.texto}
              etiqueta={`Valor ${valor.texto}`}
              alConfirmar={(texto) => dispatch({ tipo: "renombrarValor", valorId: valor.id, texto })}
              deshabilitado={deshabilitado}
              ancho
              className="h-9 min-w-0 overflow-hidden text-ellipsis bg-transparent text-sm outline-none focus-visible:underline"
            />
            <button
              type="button"
              aria-label={`Quitar ${valor.texto} de ${opcion.nombre}`}
              disabled={deshabilitado}
              onClick={() => dispatch({ tipo: "quitarValor", valorId: valor.id })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {opcion.valores.length === 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Agregá al menos un valor</p>}
      <AgregarValor estado={estado} opcion={opcion} dispatch={dispatch} deshabilitado={deshabilitado} />
    </div>
  )
}

function AgregarOpcion({ dispatch, deshabilitado, hayOpciones }: { dispatch: Dispatch<VariantesAccion>; deshabilitado?: boolean; hayOpciones: boolean }) {
  const [nombre, setNombre] = useState("")
  const agregar = () => {
    if (nombre.trim() === "") return
    dispatch({ tipo: "agregarOpcion", nombre: nombre.trim() })
    setNombre("")
  }
  return (
    <div className="space-y-1.5">
      {!hayOpciones && (
        <p className="text-xs text-muted-foreground">Una opción es lo que cambia entre una variante y otra, por ejemplo Color, Talle o Capacidad.</p>
      )}
      <div className="flex items-center gap-2">
        <Input
          aria-label="Nombre de la nueva opción"
          placeholder={hayOpciones ? "Otra opción" : "Color, Talle, Capacidad…"}
          value={nombre}
          disabled={deshabilitado}
          autoComplete="off"
          className="h-11 sm:h-9"
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            agregar()
          }}
        />
        <button
          type="button"
          disabled={deshabilitado}
          onClick={agregar}
          className="inline-flex h-11 sm:h-9 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Agregar opción
        </button>
      </div>
    </div>
  )
}

export function OpcionesEditor({ estado, dispatch, deshabilitado }: Props) {
  const opciones = estado.opciones
  const completo = opciones.length >= LIMITES.opciones
  return (
    <div role="group" aria-label="Opciones de las variantes" className="space-y-3">
      {opciones.map((opcion) => (
        <FilaDeOpcion key={opcion.id} estado={estado} opcion={opcion} dispatch={dispatch} deshabilitado={deshabilitado} />
      ))}
      {completo ? (
        <p className="text-xs text-muted-foreground">Llegaste al máximo de {LIMITES.opciones} opciones</p>
      ) : (
        <AgregarOpcion dispatch={dispatch} deshabilitado={deshabilitado} hayOpciones={opciones.length > 0} />
      )}
    </div>
  )
}
