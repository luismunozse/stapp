import { useEffect, useReducer, type Dispatch, type ReactNode } from "react"
import { render } from "@testing-library/react"
import { crearReductor, estadoInicial, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor } from "./variantes-filas"

/** What a mounted component did: the state it holds now and every action it dispatched. */
export interface Salida {
  estado: VariantesState
  acciones: VariantesAccion[]
}

/**
 * Mounts a component over the REAL reducer (useReducer(crearReductor(), inicial)), the way the form will.
 * `salida.estado` is the live state and `salida.acciones` the actions the component dispatched, in order.
 */
export function montar(inicial: VariantesState, dibujar: (estado: VariantesState, dispatch: Dispatch<VariantesAccion>) => ReactNode) {
  const salida: Salida = { estado: inicial, acciones: [] }
  const reducir = crearReductor()
  function Anfitrion() {
    const [estado, dispatch] = useReducer(reducir, inicial)
    useEffect(() => {
      salida.estado = estado
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
