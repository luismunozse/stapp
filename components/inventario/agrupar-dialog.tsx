"use client"

import { useEffect, useRef, useState } from "react"
import { Package, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { ignoreSelectEcho } from "@/lib/radix-select-echo"
import { claveCombinacion, generarIdCliente } from "@/lib/variantes"
import { LIMITES } from "@/lib/variantes-schema"
import {
  camposQueDifieren,
  construirCuerpoAgrupar,
  motivoDeBloqueo,
  prefijoComun,
  fuentePorDefecto,
  seguimientoQueSeApaga,
  seguimientoQueSePrende,
  TEXTO_MOTIVO,
  validarAgrupacion,
  vistaPrevia,
  type AsignacionAgrupar,
  type ItemAgrupable,
  type OpcionAgrupar,
} from "@/lib/variantes-agrupar"
import type { Inventario } from "@/types"

/*
 * "Agrupar productos existentes como variantes". The user names the options (Color, Talle...), lists their
 * values, gives every product its own combination and confirms. Nothing but the combination changes: each
 * product keeps its id, code, barcode, prices, stock, history and photos (the request carries {id, atributos}
 * per product). Names are rewritten only when "Renombrar productos" is on, and the preview shows exactly
 * what will happen. The group id is minted once per opening, so a retry after a failure converges.
 */

interface Props {
  open: boolean
  items: Inventario[]
  onClose: () => void
  /** The group was saved. The caller refreshes the list and closes the dialog. */
  onAgrupado: () => void
}

const MENSAJE_RED = "No pudimos agrupar los productos. Revisá la conexión y probá de nuevo"
const MENSAJE_GENERICO = "No pudimos agrupar los productos. Probá de nuevo"
const FALTA_FUENTE = "Elegí de qué producto se toman los datos"

type Revision = "con" | "sin" | "error"

/** Does the item have series or lots loaded? One small request per item and kind, only when the source would turn that tracking off. */
async function revisarSeguimiento(itemId: string, tipo: "series" | "lotes", senal: AbortSignal): Promise<Revision> {
  try {
    const url = tipo === "series" ? `/api/inventario/${itemId}/series?limit=1` : `/api/inventario/${itemId}/lotes`
    const res = await fetch(url, { signal: senal })
    if (!res.ok) return "error"
    const cuerpo = await res.json()
    return Array.isArray(cuerpo?.data) && cuerpo.data.length > 0 ? "con" : "sin"
  } catch {
    return "error"
  }
}

interface RiesgoDeSeguimiento {
  clave: string
  texto: string
}

const nombreDeSeguimiento = (tipo: "series" | "lotes") => (tipo === "series" ? "series" : "lotes")

function textoDeApagado(nombre: string, tipo: "series" | "lotes", resultado: "con" | "error"): string {
  const que = nombreDeSeguimiento(tipo)
  if (resultado === "error") {
    return `Entiendo que ${nombre} deja de controlar ${que} y que, si tiene ${que} cargados, las ventas no los van a marcar como vendidos (no pudimos revisar si tiene).`
  }
  return tipo === "series"
    ? `Entiendo que ${nombre} deja de controlar series: las ventas van a descontar stock sin marcar series vendidas. Los números de serie que ya cargaste se conservan.`
    : `Entiendo que ${nombre} deja de controlar lotes: las ventas van a descontar stock sin tocar los lotes. Los lotes que ya cargaste se conservan.`
}

function textoDePrendido(nombre: string, tipo: "series" | "lotes"): string {
  const que = nombreDeSeguimiento(tipo)
  return `Entiendo que ${nombre} va a pedir ${que} al venderlo: si no tiene ${que} cargados, no se va a poder vender hasta cargarlos.`
}

let contadorOpciones = 0
const nuevaOpcion = (nombre: string): OpcionAgrupar => ({ id: `opcion-${++contadorOpciones}`, nombre, valores: [] })

/** The values typed in one go: comma separated, trimmed, without blanks. */
const valoresDeTexto = (texto: string) => texto.split(",").map((v) => v.trim()).filter(Boolean)

export function AgruparDialog({ open, items, onClose, onAgrupado }: Props) {
  // The state lives in an inner component that exists only while the dialog is open: every opening starts
  // fresh (checkbox on, nothing assigned) and gets its own group id.
  if (!open) return null
  return <Contenido items={items} onClose={onClose} onAgrupado={onAgrupado} />
}

function Miniatura({ item }: { item: ItemAgrupable }) {
  // The item's OWN photo only: a photo borrowed from a sibling would suggest the wrong product.
  return item.imagenUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.imagenUrl} alt={`Foto de ${item.nombre}`} loading="lazy" decoding="async" width={40} height={40} className="size-10 shrink-0 rounded-md border object-cover" />
  ) : (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
      <Package className="size-4" />
    </span>
  )
}

function Contenido({ items: itemsIniciales, onClose, onAgrupado }: Omit<Props, "open">) {
  const [grupoId] = useState(generarIdCliente)
  const [quitados, setQuitados] = useState<ReadonlySet<string>>(new Set())
  const [opciones, setOpciones] = useState<OpcionAgrupar[]>(() => [nuevaOpcion("Color")])
  const [textos, setTextos] = useState<Record<string, string>>({})
  const [asignacion, setAsignacion] = useState<AsignacionAgrupar>({})
  const [base, setBase] = useState(() => prefijoComun(itemsIniciales.map((i) => i.nombre)))
  const [renombrar, setRenombrar] = useState(true)
  const [fuenteElegida, setFuenteElegida] = useState<string | null>(() => fuentePorDefecto(itemsIniciales))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enCurso = useRef(false)

  const items = itemsIniciales.filter((i) => !quitados.has(i.id))
  const elegibles = items.filter((i) => motivoDeBloqueo(i) === null)
  const diferencias = camposQueDifieren(elegibles)
  const fuenteId = elegibles.some((i) => i.id === fuenteElegida) ? fuenteElegida : null
  const faltaFuente = diferencias.length > 0 && fuenteId === null

  const apagados = seguimientoQueSeApaga(elegibles, fuenteId)
  const claveApagados = apagados.map((a) => `${a.itemId}:${a.tipo}`).join(",")
  const [revisiones, setRevisiones] = useState<Record<string, Revision>>({})
  useEffect(() => {
    const control = new AbortController()
    for (const { itemId, tipo } of seguimientoQueSeApaga(elegibles, fuenteId)) {
      const clave = `${itemId}:${tipo}`
      if (revisiones[clave] !== undefined) continue
      void revisarSeguimiento(itemId, tipo, control.signal).then((resultado) => {
        if (!control.signal.aborted) setRevisiones((previas) => ({ ...previas, [clave]: resultado }))
      })
    }
    return () => control.abort()
    // Re-runs when the set of items at risk changes; the closure reads the lists of that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveApagados])
  // While a check is open the answer to "does it have serials or lots?" is unknown: nothing can be confirmed.
  const revisando = apagados.some((a) => revisiones[`${a.itemId}:${a.tipo}`] === undefined)

  // Every consequence of the source's tracking that touches stock control needs its own explicit "Entiendo":
  // tracking turned OFF for a product that has serials or lots (or whose check failed), and tracking turned ON.
  const [reconocidos, setReconocidos] = useState<ReadonlySet<string>>(new Set())
  const riesgos: RiesgoDeSeguimiento[] = [
    ...apagados.flatMap((a): RiesgoDeSeguimiento[] => {
      const resultado = revisiones[`${a.itemId}:${a.tipo}`]
      const item = elegibles.find((i) => i.id === a.itemId)
      if (!item || (resultado !== "con" && resultado !== "error")) return []
      return [{ clave: `${fuenteId}:${a.itemId}:${a.tipo}:apaga`, texto: textoDeApagado(item.nombre, a.tipo, resultado) }]
    }),
    ...seguimientoQueSePrende(elegibles, fuenteId).flatMap((a): RiesgoDeSeguimiento[] => {
      const item = elegibles.find((i) => i.id === a.itemId)
      return item ? [{ clave: `${fuenteId}:${a.itemId}:${a.tipo}:prende`, texto: textoDePrendido(item.nombre, a.tipo) }] : []
    }),
  ]
  const faltaReconocer = riesgos.some((r) => !reconocidos.has(r.clave))

  const entrada = { base, opciones, items, asignacion }
  const problemas = validarAgrupacion(entrada)
  const mensajes = [...new Set(problemas.map((p) => p.mensaje))]
  if (faltaFuente) mensajes.push(FALTA_FUENTE)
  const listo = mensajes.length === 0 && !guardando && !revisando && !faltaReconocer

  const cambiarOpcion = (id: string, cambio: Partial<OpcionAgrupar>) =>
    setOpciones((previas) => previas.map((o) => (o.id === id ? { ...o, ...cambio } : o)))

  const agregarValores = (opcion: OpcionAgrupar) => {
    const nuevos = valoresDeTexto(textos[opcion.id] ?? "")
    setTextos((previos) => ({ ...previos, [opcion.id]: "" }))
    if (nuevos.length === 0) return
    const claves = new Set(opcion.valores.map((v) => claveCombinacion([{ opcion: "", valor: v }])))
    const aAgregar: string[] = []
    for (const valor of nuevos) {
      const clave = claveCombinacion([{ opcion: "", valor }])
      if (claves.has(clave)) continue
      claves.add(clave)
      aAgregar.push(valor)
    }
    if (aAgregar.length > 0) cambiarOpcion(opcion.id, { valores: [...opcion.valores, ...aAgregar] })
  }

  const quitarOpcion = (id: string) => {
    setOpciones((previas) => previas.filter((o) => o.id !== id))
    setAsignacion((previa) =>
      Object.fromEntries(Object.entries(previa).map(([itemId, porOpcion]) => [itemId, Object.fromEntries(Object.entries(porOpcion).filter(([k]) => k !== id))]))
    )
  }

  const elegirValor = (itemId: string, opcionId: string, valor: string) =>
    setAsignacion((previa) => ({ ...previa, [itemId]: { ...previa[itemId], [opcionId]: valor } }))

  const guardar = async () => {
    if (!listo || enCurso.current) return
    enCurso.current = true
    setGuardando(true)
    setError(null)
    try {
      const cuerpo = construirCuerpoAgrupar({ ...entrada, items: elegibles, renombrar, fuenteId: diferencias.length > 0 ? fuenteId : null })
      const res = await fetch(`/api/inventario/grupos/${grupoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      })
      if (!res.ok) {
        const detalle = await res.json().catch(() => null)
        setError(typeof detalle?.error === "string" && detalle.error ? detalle.error : MENSAJE_GENERICO)
        return
      }
      onAgrupado()
    } catch {
      setError(MENSAJE_RED)
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }

  const vista = vistaPrevia({ ...entrada, items: elegibles, renombrar })

  return (
    <ResponsiveDialog open onOpenChange={(abierto) => !abierto && !guardando && onClose()}>
      <ResponsiveDialogContent className="sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Agrupar como variantes</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Elegí en qué se diferencian estos productos y cuál es cada uno. Cada producto conserva su código, su stock, sus precios y su foto.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          <section className="space-y-2">
            <Label htmlFor="agrupar-base">Nombre del producto</Label>
            <Input id="agrupar-base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="Por ejemplo, Funda X" />
          </section>

          <section className="space-y-3" aria-label="Opciones">
            <p className="text-sm font-medium">En qué se diferencian</p>
            {opciones.map((opcion, i) => (
              <div key={opcion.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Nombre de la opción ${i + 1}`}
                    value={opcion.nombre}
                    maxLength={LIMITES.nombreOpcion}
                    onChange={(e) => cambiarOpcion(opcion.id, { nombre: e.target.value })}
                  />
                  {opciones.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Quitar la opción ${i + 1}`} onClick={() => quitarOpcion(opcion.id)}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {opcion.valores.map((valor) => (
                    <li key={valor} data-chip className="inline-flex items-center gap-1 rounded-full bg-secondary py-1 pl-3 pr-1 text-sm">
                      {valor}
                      <button
                        type="button"
                        aria-label={`Quitar ${valor}`}
                        className="flex size-6 items-center justify-center rounded-full hover:bg-background"
                        onClick={() => cambiarOpcion(opcion.id, { valores: opcion.valores.filter((v) => v !== valor) })}
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Valor nuevo de ${opcion.nombre}`}
                    placeholder="Escribí un valor y apretá Enter"
                    value={textos[opcion.id] ?? ""}
                    onChange={(e) => setTextos((previos) => ({ ...previos, [opcion.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return
                      e.preventDefault()
                      agregarValores(opcion)
                    }}
                  />
                  <Button type="button" variant="outline" size="icon" aria-label={`Agregar el valor a ${opcion.nombre}`} onClick={() => agregarValores(opcion)}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
            {opciones.length < LIMITES.opciones && (
              <Button type="button" variant="outline" size="sm" onClick={() => setOpciones((previas) => [...previas, nuevaOpcion("")])}>
                Agregar otra opción
              </Button>
            )}
          </section>

          <section className="space-y-2" aria-label="Productos">
            <p className="text-sm font-medium">Qué variante es cada producto</p>
            <ul className="space-y-2">
              {items.map((item) => {
                const motivo = motivoDeBloqueo(item)
                return (
                  <li key={item.id} data-testid={`item-${item.id}`} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <Miniatura item={item} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.nombre}</p>
                        <p className="truncate text-xs text-muted-foreground">{item.codigo}</p>
                      </div>
                    </div>
                    {motivo ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-destructive">{TEXTO_MOTIVO[motivo]}</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setQuitados((previos) => new Set(previos).add(item.id))}
                        >
                          Sacar de la lista
                        </Button>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {opciones.map((opcion, i) => {
                          const elegido = asignacion[item.id]?.[opcion.id] ?? ""
                          const vigente = opcion.valores.some((v) => claveCombinacion([{ opcion: "", valor: v }]) === claveCombinacion([{ opcion: "", valor: elegido }]))
                          return (
                            <Select
                              key={opcion.id}
                              value={vigente ? elegido : ""}
                              onValueChange={ignoreSelectEcho((valor) => elegirValor(item.id, opcion.id, valor))}
                            >
                              <SelectTrigger aria-label={`${opcion.nombre.trim() || `Opción ${i + 1}`} de ${item.nombre}`}>
                                <SelectValue placeholder={opcion.nombre.trim() || `Opción ${i + 1}`} />
                              </SelectTrigger>
                              <SelectContent>
                                {opcion.valores.map((valor) => (
                                  <SelectItem key={valor} value={valor}>
                                    {valor}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )
                        })}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="space-y-2" aria-label="Nombres">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input type="checkbox" className="size-4" checked={renombrar} onChange={(e) => setRenombrar(e.target.checked)} />
              Renombrar productos
            </label>
            {!renombrar && (
              <p className="text-sm text-muted-foreground">
                Los nombres, los códigos y los códigos de barras no cambian. Si después cambiás el nombre del producto, estos nombres no se tocan.
              </p>
            )}
            <ul className="divide-y rounded-md border text-sm">
              {vista.map((fila) => (
                <li key={fila.id} data-testid={`vista-${fila.id}`} className="grid gap-1 px-3 py-2 sm:grid-cols-2">
                  <span className="text-muted-foreground">{fila.antes}</span>
                  <span className="font-medium">
                    {fila.despues ?? (renombrar ? "Falta elegir la variante" : "Sin cambios")}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {diferencias.length > 0 && (
            <section data-testid="datos-distintos" className="space-y-2" aria-label="Datos distintos">
              <p className="text-sm font-medium">Estos productos tienen datos distintos</p>
              <p className="text-sm text-muted-foreground">Todos van a quedar con los datos del producto que elijas.</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-3 py-2 font-medium">Dato</th>
                      {elegibles.map((item) => (
                        <th key={item.id} className="px-3 py-2 font-medium">
                          {item.nombre}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {diferencias.map((campo) => (
                      <tr key={campo.clave} className="border-b last:border-0">
                        <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">
                          {campo.etiqueta}
                        </th>
                        {campo.valores.map((valor) => (
                          <td key={valor.itemId} className="px-3 py-2">
                            {valor.texto}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div role="radiogroup" aria-label="Producto de origen" className="space-y-1">
                {elegibles.map((item) => (
                  <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <input
                      type="radio"
                      name="agrupar-fuente"
                      aria-label={`Usar los datos de ${item.nombre}`}
                      checked={fuenteId === item.id}
                      onChange={() => setFuenteElegida(item.id)}
                    />
                    Usar los datos de {item.nombre}
                  </label>
                ))}
              </div>
              {/* A live region that exists before its content, so what appears in it is announced. */}
              <div data-testid="aviso-seguimiento" role="status" aria-live="polite" className={riesgos.length > 0 ? "space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" : undefined}>
                {riesgos.map((riesgo) => (
                  <label key={riesgo.clave} className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0"
                      checked={reconocidos.has(riesgo.clave)}
                      onChange={(e) =>
                        setReconocidos((previos) => {
                          const siguientes = new Set(previos)
                          if (e.target.checked) siguientes.add(riesgo.clave)
                          else siguientes.delete(riesgo.clave)
                          return siguientes
                        })
                      }
                    />
                    <span>{riesgo.texto}</span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {mensajes.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground" aria-label="Qué falta">
              {mensajes.map((mensaje) => (
                <li key={mensaje}>{mensaje}</li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <ResponsiveDialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" onClick={guardar} disabled={!listo}>
            {guardando ? "Agrupando…" : revisando ? "Revisando…" : "Agrupar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
