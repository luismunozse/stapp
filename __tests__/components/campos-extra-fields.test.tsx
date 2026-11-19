// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CamposExtraFields } from "@/components/ordenes/campos-extra-fields"
import type { CampoExtra, TipoDispositivoConfig } from "@/types"

const ram: CampoExtra = { key: "ram", label: "RAM", tipo: "select", opciones: ["4GB", "8GB"] } as CampoExtra
const config = {} as TipoDispositivoConfig

describe("CamposExtraFields: select con valor libre", () => {
  it("sin valor muestra el select con su placeholder", () => {
    render(<CamposExtraFields campos={[ram]} values={{}} config={config} onChange={vi.fn()} />)
    expect(screen.getByText("Seleccionar...")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Escribir...")).not.toBeInTheDocument()
  })

  it("un valor fuera de la lista se muestra como texto editable", () => {
    const onChange = vi.fn()
    render(<CamposExtraFields campos={[ram]} values={{ ram: "3GB" }} config={config} onChange={onChange} />)
    const input = screen.getByLabelText("RAM")
    expect(input).toHaveValue("3GB")
    fireEvent.change(input, { target: { value: "6GB" } })
    expect(onChange).toHaveBeenCalledWith(ram, "6GB")
  })

  it("volver a la lista limpia el valor escrito a mano", () => {
    const onChange = vi.fn()
    render(<CamposExtraFields campos={[ram]} values={{ ram: "3GB" }} config={config} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Volver a la lista de RAM" }))
    expect(onChange).toHaveBeenCalledWith(ram, "")
  })
})
