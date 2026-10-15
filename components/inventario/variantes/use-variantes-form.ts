"use client"

import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from "react"
import type { Inventario } from "@/types"
import { generarIdCliente } from "@/lib/variantes"
import { crearReductor, estadoDesdeGrupo, estadoInicial, type GrupoLeido, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import {
  construirCuerpoGrupo,
  interpretarGuardado,
  reasignarCodigosDuplicados,
  type CompartidosForm,
  type CuerpoGrupo,
  type SalidaGuardado,
} from "@/lib/variantes-guardado"

/*
 * Everything the product form needs from the variants, in one place: the reducer state, loading a saved
 * group, and the two calls to the group endpoint (save and ungroup). The form keeps the rest of the flow
 * (confirmations, photos, closing) because it owns those pieces. Client code: it imports only the pure
 * modules, never lib/variantes-api.ts.
 */

const MENSAJE_KIT = "Un kit no puede tener variantes"
const MENSAJE_PENDIENTE = "Variantes todavía no está disponible"
const MENSAJE_CARGA = "No pudimos cargar las variantes de este producto. Cerrá y volvé a abrirlo."
const MENSAJE_RED = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo."

export interface ParametrosVariantesForm {
  /** The form may show the section at all (the dark-launch gate). */
  permite: boolean
  item?: Inventario | null
  costoCargado: boolean
  /** The code the generated codes start from. */
  codigoBase: string
  /** The product's own price and cost fields ("Precio base", "Costo base"). */
  precioBase: number
  costoBase: number
  esKit: boolean
  /** A saved group was read: the form copies its name and shared fields. */
  alHidratar?: (lectura: GrupoLeido) => void
}

export interface DatosDeGuardado {
  nombre: string
  compartidos: CompartidosForm
  compartidosPrevios: CompartidosForm | null
  depositoId?: string | null
}

/** What the save came to; "rechazado" means the body was refused before any request (a blank or repeated code). */
export type SalidaDePut = SalidaGuardado | { tipo: "rechazado"; mensaje: string }

export interface VariantesDelForm {
  estado: VariantesState
  dispatch: Dispatch<VariantesAccion>
  /** The state as the server last gave it (null while the group does not exist). */
  original: VariantesState | null
  /** There is a saved group behind this form. */
  agrupado: boolean
  cargando: boolean
  motivoDeshabilitado: string | null
  /** Reads the group again and replaces the state with it. Returns what it read, or null. */
  recargar: () => Promise<GrupoLeido | null>
  guardar: (datos: DatosDeGuardado) => Promise<SalidaDePut>
  /** A missing group (404) counts as done. */
  desagrupar: () => Promise<{ ok: true } | { ok: false; mensaje: string }>
}

const jsonONulo = (res: Response) => res.json().catch(() => null)

export function useVariantesForm(p: ParametrosVariantesForm): VariantesDelForm {
  const [reducir] = useState(() => crearReductor())
  const [estado, dispatch] = useReducer(reducir, undefined, () =>
    estadoInicial({
      grupoId: p.item?.grupoId ?? generarIdCliente(),
      codigoBase: p.codigoBase,
      precioBase: Number.isFinite(p.precioBase) ? p.precioBase : 0,
      costoBase: Number.isFinite(p.costoBase) ? p.costoBase : 0,
      costoCargado: p.costoCargado,
    })
  )
  const [original, setOriginal] = useState<VariantesState | null>(null)
  const [cargando, setCargando] = useState(p.permite && !!p.item?.grupoId)
  const [errorDeCarga, setErrorDeCarga] = useState(false)
  const [pendiente, setPendiente] = useState(false)

  // The latest inputs, read by async work that outlives the render that started it.
  const ultimo = useRef(p)
  useEffect(() => {
    ultimo.current = p
  })
  const grupoId = estado.grupoId

  const recargar = useCallback(async (): Promise<GrupoLeido | null> => {
    try {
      const res = await fetch(`/api/inventario/grupos/${grupoId}`)
      const cuerpo = await jsonONulo(res)
      if (res.status === 503 || cuerpo?.code === "MIGRACION_PENDIENTE") {
        setPendiente(true)
        return null
      }
      if (!res.ok || !cuerpo?.grupo) {
        setErrorDeCarga(true)
        return null
      }
      const actual = ultimo.current
      const lectura = cuerpo as GrupoLeido
      const fresco = estadoDesdeGrupo(lectura, {
        costoCargado: actual.costoCargado,
        codigoBase: actual.codigoBase,
        precioBase: Number.isFinite(actual.precioBase) ? actual.precioBase : undefined,
        costoBase: Number.isFinite(actual.costoBase) ? actual.costoBase : undefined,
      })
      setErrorDeCarga(false)
      setOriginal(fresco)
      dispatch({ tipo: "reemplazar", estado: fresco })
      actual.alHidratar?.(lectura)
      return lectura
    } catch {
      setErrorDeCarga(true)
      return null
    }
  }, [grupoId])

  // Opening a variant loads its group once.
  const idAbierto = p.permite ? (p.item?.grupoId ?? null) : null
  useEffect(() => {
    if (!idAbierto) return
    let vigente = true
    void recargar().finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [idAbierto, recargar])

  // The product's own fields drive the base values of the section.
  useEffect(() => {
    if (!p.permite || !estado.activo) return
    if (Number.isFinite(p.precioBase) && p.precioBase >= 0 && p.precioBase !== estado.precioBase) dispatch({ tipo: "cambiarPrecioBase", precio: p.precioBase })
  }, [p.permite, p.precioBase, estado.activo, estado.precioBase])
  useEffect(() => {
    if (!p.permite || !estado.activo || !p.costoCargado) return
    if (Number.isFinite(p.costoBase) && p.costoBase >= 0 && p.costoBase !== estado.costoBase) dispatch({ tipo: "cambiarCostoBase", costo: p.costoBase })
  }, [p.permite, p.costoCargado, p.costoBase, estado.activo, estado.costoBase])
  useEffect(() => {
    if (!p.permite || !estado.activo || p.codigoBase === "" || p.codigoBase === estado.codigoBase) return
    dispatch({ tipo: "cambiarCodigoBase", codigo: p.codigoBase })
  }, [p.permite, p.codigoBase, estado.activo, estado.codigoBase])

  const enviar = async (cuerpo: CuerpoGrupo): Promise<SalidaGuardado> => {
    const res = await fetch(`/api/inventario/grupos/${grupoId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    })
    return interpretarGuardado(res.status, await jsonONulo(res))
  }

  const guardar = async (datos: DatosDeGuardado): Promise<SalidaDePut> => {
    const construido = construirCuerpoGrupo({ estado, original, ...datos })
    if (!construido.ok) return { tipo: "rechazado", mensaje: construido.motivo }
    try {
      let salida = await enviar(construido.cuerpo)
      if (salida.tipo === "codigo-duplicado") {
        // A generated code clashed with another product: the next free suffix, once.
        const otro = reasignarCodigosDuplicados(construido.cuerpo, estado, salida.codigos)
        if (otro) salida = await enviar(otro)
      }
      if (salida.tipo === "pendiente") {
        setPendiente(true)
        dispatch({ tipo: "desactivar" })
      }
      if (salida.tipo === "recargar") await recargar()
      return salida
    } catch {
      return { tipo: "error", mensaje: MENSAJE_RED }
    }
  }

  const desagrupar = async (): Promise<{ ok: true } | { ok: false; mensaje: string }> => {
    try {
      const res = await fetch(`/api/inventario/grupos/${grupoId}`, { method: "DELETE" })
      if (res.ok || res.status === 404) return { ok: true }
      const cuerpo = await jsonONulo(res)
      return { ok: false, mensaje: typeof cuerpo?.error === "string" ? cuerpo.error : "No pudimos desagrupar las variantes. Probá de nuevo." }
    } catch {
      return { ok: false, mensaje: MENSAJE_RED }
    }
  }

  const motivoDeshabilitado = p.esKit ? MENSAJE_KIT : pendiente ? MENSAJE_PENDIENTE : errorDeCarga ? MENSAJE_CARGA : null

  return { estado, dispatch, original, agrupado: original !== null, cargando, motivoDeshabilitado, recargar, guardar, desagrupar }
}
