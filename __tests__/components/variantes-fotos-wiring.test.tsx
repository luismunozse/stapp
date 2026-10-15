import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { CombinacionesTabla } from "@/components/inventario/variantes/combinaciones-tabla"
import { CombinacionesCards } from "@/components/inventario/variantes/combinacion-card"
import { VariantesSection } from "@/components/inventario/variantes/variantes-section"
import { FotoDeFila } from "@/components/inventario/variantes/foto-variante"
import { respaldoDeFila } from "@/components/inventario/variantes/vista"
import type { FotosVariantes, VistaFoto } from "@/components/inventario/variantes/use-fotos-variantes"
import type { VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor, filaDe, grupoColor, hidratar, leida, valorId } from "../helpers/variantes-filas"
import { montar } from "../helpers/variantes-ui"

vi.mock("@/components/inventario/quick-stock-adjust", () => ({
  QuickStockAdjust: () => <span>stock</span>,
}))

const vacia: VistaFoto = { pendiente: null, quitar: false, subida: null, errorAlQuitar: null }

function fotosFalsas(vistas: Record<string, VistaFoto> = {}): FotosVariantes {
  return {
    de: (id) => vistas[id] ?? vacia,
    elegir: vi.fn(async () => ({ ok: true as const })),
    descartar: vi.fn(),
    alternarQuitar: vi.fn(),
    subirTodas: vi.fn(async () => ({ hechas: [], fallidas: [] })),
    reintentar: vi.fn(async () => true),
    idsConFotoPendiente: () => [],
  }
}

const color = (valor: string) => ({ opcion: "Color", valor })

/** Color {Rojo, Azul}: Rojo saved with a photo, Azul without, Verde archived. */
const conFotoEnRojo = () =>
  hidratar(
    grupoColor({
      variantes: [leida("r1", [color("Rojo")], { imagenUrl: "https://cdn/rojo.jpg" }), leida("a1", [color("Azul")])],
    })
  )

describe("respaldoDeFila", () => {
  it("lends the first active sibling's photo, in combination order, with its label", () => {
    const e = hidratar(
      grupoColor({
        variantes: [
          leida("r1", [color("Rojo")]),
          leida("a1", [color("Azul")], { imagenUrl: "https://cdn/azul.jpg" }),
          leida("v1", [color("Verde")], { imagenUrl: "https://cdn/verde.jpg" }),
        ],
        grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul", "Verde"] }] },
        archivadas: [],
      })
    )
    expect(respaldoDeFila(e, filaDe(e, "Rojo"))).toEqual({ url: "https://cdn/azul.jpg", etiqueta: "Azul" })
  })

  it("never lends to a row that has its own photo, and never lends the row's own", () => {
    const e = conFotoEnRojo()
    expect(respaldoDeFila(e, filaDe(e, "Rojo"))).toBeNull()
    expect(respaldoDeFila(e, filaDe(e, "Azul"))).toEqual({ url: "https://cdn/rojo.jpg", etiqueta: "Rojo" })
  })

  it("nobody has a photo: nothing to borrow", () => {
    const e = hidratar(grupoColor())
    expect(respaldoDeFila(e, filaDe(e, "Azul"))).toBeNull()
  })

  it("a row pending archive neither lends nor borrows", () => {
    const e = aplicar(reductor(), conFotoEnRojo(), { tipo: "quitarValor", valorId: valorId(conFotoEnRojo(), "Color", "Rojo") })
    const azul = filaDe(e, "Azul")
    expect(respaldoDeFila(e, azul)).toBeNull()
    const archivada = Object.values(e.filas).find((f) => f.archivar)
    expect(archivada).toBeTruthy()
    expect(respaldoDeFila(e, archivada!)).toBeNull()
  })
})

describe("photo slot wiring", () => {
  it("without `fotos` nothing about photos is rendered (the tree is what it was before)", () => {
    montar(conFotoEnRojo(), (e, d) => (
      <>
        <CombinacionesTabla estado={e} dispatch={d} />
        <CombinacionesCards estado={e} dispatch={d} />
      </>
    ))
    expect(screen.queryByText("Foto")).toBeNull()
    expect(document.querySelectorAll('[data-testid^="foto-"]')).toHaveLength(0)
  })

  it("the table gets a Foto column and one slot per active row, 40px, with the sibling fallback", () => {
    const e = conFotoEnRojo()
    montar(e, (estado, d) => <CombinacionesTabla estado={estado} dispatch={d} fotos={fotosFalsas()} />)
    expect(screen.getByRole("columnheader", { name: "Foto" })).toBeInTheDocument()
    const rojo = within(screen.getByTestId(`foto-${filaDe(e, "Rojo").id}`))
    expect(rojo.getByRole("button", { name: "Cambiar foto de Rojo" }).className).toContain("h-10")
    const azul = within(screen.getByTestId(`foto-${filaDe(e, "Azul").id}`))
    expect(azul.getByText("Foto de Rojo")).toBeInTheDocument()
    expect(azul.getByRole("button", { name: "Agregar foto de Azul" })).toBeInTheDocument()
  })

  it("the cards get the 56px slot in the header", () => {
    const e = conFotoEnRojo()
    montar(e, (estado, d) => <CombinacionesCards estado={estado} dispatch={d} fotos={fotosFalsas()} />)
    const rojo = within(screen.getByTestId(`foto-${filaDe(e, "Rojo").id}`))
    expect(rojo.getByRole("button", { name: "Cambiar foto de Rojo" }).className).toContain("h-14")
    const tarjeta = screen.getByTestId(`foto-${filaDe(e, "Rojo").id}`).closest("article")!
    expect(tarjeta.querySelector("header")).toContainElement(screen.getByTestId(`foto-${filaDe(e, "Rojo").id}`))
  })

  it("rows pending archive get no slot, in the table or in the cards", () => {
    const inicial = conFotoEnRojo()
    const e = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Azul") })
    const archivada = Object.values(e.filas).find((f) => f.archivar)!
    montar(e, (estado, d) => (
      <>
        <CombinacionesTabla estado={estado} dispatch={d} fotos={fotosFalsas()} />
        <CombinacionesCards estado={estado} dispatch={d} fotos={fotosFalsas()} />
      </>
    ))
    expect(screen.queryAllByTestId(`foto-${archivada.id}`)).toHaveLength(0)
    expect(screen.getAllByTestId(`foto-${filaDe(e, "Rojo").id}`)).toHaveLength(2)
  })

  it("the table keeps its columns aligned: header, rows and the archive heading agree", () => {
    const inicial = conFotoEnRojo()
    const e = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Azul") })
    montar(e, (estado, d) => <CombinacionesTabla estado={estado} dispatch={d} fotos={fotosFalsas()} />)
    const tabla = screen.getByRole("table")
    const columnas = tabla.querySelectorAll("thead th").length
    expect(tabla.querySelector("tbody tr")!.children).toHaveLength(columnas)
    expect(tabla.querySelector('th[scope="colgroup"]')!.getAttribute("colspan")).toBe(String(columnas))
  })

  it("the slot talks to the hook with the row id", () => {
    const e = conFotoEnRojo()
    const fotos = fotosFalsas()
    montar(e, (estado, d) => <CombinacionesTabla estado={estado} dispatch={d} fotos={fotos} />)
    const id = filaDe(e, "Rojo").id
    fireEvent.click(within(screen.getByTestId(`foto-${id}`)).getByRole("button", { name: "Quitar foto de Rojo" }))
    expect(fotos.alternarQuitar).toHaveBeenCalledWith(id)
  })

  it("retry hands the hook the row's id, saved photo and archive flag", () => {
    const e = conFotoEnRojo()
    const id = filaDe(e, "Rojo").id
    const fotos = fotosFalsas({ [id]: { ...vacia, quitar: true, errorAlQuitar: "No se pudo quitar la foto." } })
    montar(e, (estado, d) => <CombinacionesTabla estado={estado} dispatch={d} fotos={fotos} />)
    fireEvent.click(within(screen.getByTestId(`foto-${id}`)).getByRole("button", { name: /Reintentar/ }))
    expect(fotos.reintentar).toHaveBeenCalledWith({ id, imagenUrl: "https://cdn/rojo.jpg", archivar: false })
  })

  it("a row pending archive handed to the wired slot directly has every control disabled", () => {
    const inicial = conFotoEnRojo()
    const e = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Rojo") })
    const archivada = Object.values(e.filas).find((f) => f.archivar)!
    montar(e, (estado) => <FotoDeFila estado={estado} fila={archivada} fotos={fotosFalsas()} tamano="tabla" />)
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled()
  })

  it("a locked form (guardando) locks the slots", () => {
    const e = conFotoEnRojo()
    montar(e, (estado, d) => <CombinacionesTabla estado={estado} dispatch={d} fotos={fotosFalsas()} deshabilitado />)
    for (const b of within(screen.getByTestId(`foto-${filaDe(e, "Rojo").id}`)).getAllByRole("button")) expect(b).toBeDisabled()
  })

  it("the section passes `fotos` down to both views", () => {
    const e: VariantesState = conFotoEnRojo()
    montar(e, (estado, d) => <VariantesSection estado={estado} dispatch={d} fotos={fotosFalsas()} />)
    expect(screen.getAllByTestId(`foto-${filaDe(e, "Rojo").id}`)).toHaveLength(2)
  })

  it("the section without `fotos` renders no slot", () => {
    montar(conFotoEnRojo(), (estado, d) => <VariantesSection estado={estado} dispatch={d} />)
    expect(document.querySelectorAll('[data-testid^="foto-"]')).toHaveLength(0)
  })
})
