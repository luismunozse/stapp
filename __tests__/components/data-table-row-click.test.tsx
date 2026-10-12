import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { DataTable, type Column } from "@/components/ui/data-table"

/**
 * DataTable frenaba la propagación solo en la celda del checkbox de selección.
 * Con `onRowClick`, cualquier botón de acción dentro de una fila disparaba
 * además la navegación de la fila: el usuario tocaba "Cancelar" y encima se lo
 * llevaba a otra pantalla.
 *
 * Cada lista lo venía tapando por su cuenta (ventas-list con stopPropagation
 * botón por botón), lo que deja el agujero abierto para la próxima lista o el
 * próximo botón. El guard vive acá para que ninguna tenga que acordarse.
 */

interface Fila {
  id: string
  nombre: string
}

const DATA: Fila[] = [{ id: "f1", nombre: "Fila uno" }]

const onAccion = vi.fn()

const COLUMNS: Column<Fila>[] = [
  { key: "nombre", header: "Nombre" },
  {
    key: "acciones",
    header: "",
    render: () => (
      <div>
        <button type="button" onClick={onAccion}>
          Accionar
        </button>
        <a href="/otro-lado">Ir</a>
        <input aria-label="marca" type="checkbox" />
        <select aria-label="elegir">
          <option>uno</option>
        </select>
      </div>
    ),
  },
]

function renderTable(onRowClick: () => void, extra: Record<string, unknown> = {}) {
  const { container } = render(
    <DataTable
      data={DATA}
      columns={COLUMNS}
      keyExtractor={(f) => f.id}
      onRowClick={onRowClick}
      {...extra}
    />
  )
  // El split móvil/escritorio es por CSS, así que en jsdom se renderizan los
  // dos. Las aserciones apuntan a la tabla para no elegir el elemento de la
  // otra vista sin querer.
  return within(container.querySelector("table") as HTMLElement)
}

describe("DataTable — onRowClick y elementos interactivos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dispara onRowClick al tocar una celda común", () => {
    const onRowClick = vi.fn()
    const tabla = renderTable(onRowClick)

    fireEvent.click(tabla.getByText("Fila uno"))

    expect(onRowClick).toHaveBeenCalledWith(DATA[0])
  })

  it("no dispara onRowClick al tocar un botón de la fila", () => {
    const onRowClick = vi.fn()
    const tabla = renderTable(onRowClick)

    fireEvent.click(tabla.getByText("Accionar"))

    expect(onAccion).toHaveBeenCalled()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it("no dispara onRowClick al tocar un link de la fila", () => {
    const onRowClick = vi.fn()
    const tabla = renderTable(onRowClick)

    fireEvent.click(tabla.getByText("Ir"))

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it("no dispara onRowClick al tocar un input o un select de la fila", () => {
    const onRowClick = vi.fn()
    const tabla = renderTable(onRowClick)

    fireEvent.click(tabla.getByLabelText("marca"))
    fireEvent.click(tabla.getByLabelText("elegir"))

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it("sigue sin disparar onRowClick desde el checkbox de selección", () => {
    const onRowClick = vi.fn()
    const { container } = render(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        keyExtractor={(f) => f.id}
        onRowClick={onRowClick}
        selectable
        selectedKeys={[]}
        onSelectionChange={vi.fn()}
      />
    )
    // El de selección es el primer checkbox del cuerpo; el del thead es el
    // "seleccionar todo" y el otro de la fila es el del render de la columna.
    const seleccion = container.querySelector(
      'tbody input[type="checkbox"]'
    ) as HTMLElement

    fireEvent.click(seleccion)

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it("permite excluir cualquier zona con data-no-row-click", () => {
    const onRowClick = vi.fn()
    const columns: Column<Fila>[] = [
      { key: "nombre", header: "Nombre" },
      {
        key: "zona",
        header: "",
        render: () => <div data-no-row-click>zona muerta</div>,
      },
    ]
    const { container } = render(
      <DataTable data={DATA} columns={columns} keyExtractor={(f) => f.id} onRowClick={onRowClick} />
    )
    const tabla = within(container.querySelector("table") as HTMLElement)

    fireEvent.click(tabla.getByText("zona muerta"))

    expect(onRowClick).not.toHaveBeenCalled()
  })
})
