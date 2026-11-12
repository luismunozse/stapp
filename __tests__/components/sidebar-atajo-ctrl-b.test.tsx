import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SidebarProvider, useSidebar } from "@/components/layout/sidebar-context"
import { esCampoEditable } from "@/lib/teclado"

function Estado() {
  const { collapsed } = useSidebar()
  return (
    <div>
      <span data-testid="estado">{collapsed ? "colapsado" : "abierto"}</span>
      <input aria-label="campo" />
      <textarea aria-label="texto" />
      <div aria-label="editor" contentEditable suppressContentEditableWarning>
        <b>hola</b>
      </div>
      <button>botón</button>
    </div>
  )
}

function renderSidebar() {
  render(<SidebarProvider><Estado /></SidebarProvider>)
  return () => screen.getByTestId("estado").textContent
}

describe("Ctrl+B colapsa el sidebar salvo dentro de un campo", () => {
  beforeEach(() => {
    // El provider guarda el estado en una cookie que sobrevive entre tests.
    document.cookie = "sidebar:state=expanded;path=/"
  })

  it("fuera de un campo colapsa", () => {
    const estado = renderSidebar()
    fireEvent.keyDown(screen.getByRole("button", { name: "botón" }), { key: "b", ctrlKey: true })
    expect(estado()).toBe("colapsado")
  })

  it.each(["campo", "texto"])("en %s no hace nada", (label) => {
    const estado = renderSidebar()
    fireEvent.keyDown(screen.getByLabelText(label), { key: "b", ctrlKey: true })
    expect(estado()).toBe("abierto")
  })

  it("en un contenteditable no hace nada", () => {
    const estado = renderSidebar()
    fireEvent.keyDown(screen.getByLabelText("editor").querySelector("b")!, { key: "b", ctrlKey: true })
    expect(estado()).toBe("abierto")
  })

  it("esCampoEditable reconoce los campos", () => {
    const input = document.createElement("input")
    const div = document.createElement("div")
    expect(esCampoEditable(input)).toBe(true)
    expect(esCampoEditable(div)).toBe(false)
    expect(esCampoEditable(null)).toBe(false)
    expect(esCampoEditable(window)).toBe(false)
  })
})
