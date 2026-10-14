import { useEffect, useReducer, type Dispatch, type ReactNode } from "react"
import { act, render } from "@testing-library/react"
import { crearReductor, estadoInicial, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor } from "./variantes-filas"

/** What a mounted component did: the state it holds now and every action it dispatched. */
export interface Salida {
  estado: VariantesState
  acciones: VariantesAccion[]
  /** Dispatches from outside the component, the way the rest of the form would (the product's own fields). */
  despachar: (accion: VariantesAccion) => void
}

/**
 * Mounts a component over the REAL reducer (useReducer(crearReductor(), inicial)), the way the form will.
 * `salida.estado` is the live state and `salida.acciones` the actions the component dispatched, in order.
 */
export function montar(inicial: VariantesState, dibujar: (estado: VariantesState, dispatch: Dispatch<VariantesAccion>) => ReactNode) {
  let enviar: Dispatch<VariantesAccion> = () => {}
  const salida: Salida = { estado: inicial, acciones: [], despachar: (accion) => act(() => enviar(accion)) }
  const reducir = crearReductor()
  function Anfitrion() {
    const [estado, dispatch] = useReducer(reducir, inicial)
    useEffect(() => {
      salida.estado = estado
    })
    useEffect(() => {
      enviar = dispatch
    })
    const registrar: Dispatch<VariantesAccion> = (accion) => {
      salida.acciones.push(accion)
      dispatch(accion)
    }
    return <>{dibujar(estado, registrar)}</>
  }
  return { ...render(<Anfitrion />), salida }
}

/** An active, empty state with a fixed seed. */
export const estadoActivo = (over: { costoCargado?: boolean; codigoBase?: string; precioBase?: number; semilla?: string } = {}) =>
  aplicar(reductor(), estadoInicial({ grupoId: "g-nuevo", semilla: "ui-de-prueba", codigoBase: "FX", precioBase: 1000, ...over }), { tipo: "activar" })

/** Active, with Color {Rojo, Azul}: two NEW rows. */
export const estadoColor = (over: Parameters<typeof estadoActivo>[0] = {}) =>
  aplicar(reductor(), estadoActivo(over), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] })
