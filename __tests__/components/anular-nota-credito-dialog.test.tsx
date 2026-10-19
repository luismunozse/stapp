// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import React from "react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { toast } from "sonner"
import { AnularNotaCreditoDialog, type NotaCreditoParaAnular } from "@/components/notas-credito/anular-nota-credito-dialog"

const NC: NotaCreditoParaAnular = {
  id: "d1", numeroDevolucion: "NC-000012", montoAplicadoDeuda: 0, montoReembolso: 200, metodoReembolso: "EFECTIVO",
  items: [{ descripcion: "Celular", cantidad: 2, restaurarStock: true }],
}

const respuesta = (status: number, body: object) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function abrir(props: Partial<React.ComponentProps<typeof AnularNotaCreditoDialog>> = {}) {
  const onAnulada = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <AnularNotaCreditoDialog
      open
      onOpenChange={onOpenChange}
      ventaId="v1"
      nc={NC}
      tieneCliente
      saldoCliente={0}
      onAnulada={onAnulada}
      {...props}
    />
  )
  return { onAnulada, onOpenChange }
}
const motivo = () => screen.getByLabelText("Motivo de la anulación")
const confirmar = () => screen.getByRole("button", { name: "Anular nota de crédito" })

describe("AnularNotaCreditoDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("muestra qué se revierte y no deja confirmar sin motivo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(200, { sesion: { id: "s1" } })))
    abrir()
    expect(screen.getByRole("dialog", { name: "Anular la nota de crédito NC-000012" })).toBeInTheDocument()
    expect(screen.getByText("Vuelven a salir del stock: 2 × Celular.")).toBeInTheDocument()
    expect(screen.getByText(/Vuelven a entrar a la caja/)).toBeInTheDocument()
    expect(confirmar()).toBeDisabled()
    fireEvent.change(motivo(), { target: { value: "   " } })
    expect(confirmar()).toBeDisabled()
    await act(async () => {})
  })

  it("anula con el motivo sin espacios, avisa, cierra y pide releer la venta", async () => {
    const fetchMock = vi.fn(async () => respuesta(200, { efectivoSinEgreso: false, replayed: false }))
    vi.stubGlobal("fetch", fetchMock)
    const { onAnulada, onOpenChange } = abrir()
    fireEvent.change(motivo(), { target: { value: "  Se cargó en la venta equivocada " } })
    fireEvent.click(confirmar())
    await waitFor(() => expect(onAnulada).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ventas/v1/devolucion/d1/anular",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ motivo: "Se cargó en la venta equivocada" }) })
    )
    expect(toast.success).toHaveBeenCalledWith("Nota de crédito NC-000012 anulada")
    expect(toast.warning).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("si la base no encontró el egreso de caja, avisa que no entró plata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(200, { efectivoSinEgreso: true, replayed: false })))
    const { onAnulada } = abrir()
    fireEvent.change(motivo(), { target: { value: "Error" } })
    fireEvent.click(confirmar())
    await waitFor(() => expect(onAnulada).toHaveBeenCalled())
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/no se registró ningún ingreso/))
  })

  it("un bloqueo de la base se muestra adentro del diálogo, que queda abierto", async () => {
    const mensaje =
      'No hay stock de "Celular" en Depósito Casa Central para volver a descontar lo que devolvió la nota de crédito: hay 0, hacen falta 2'
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(409, { error: mensaje })))
    const { onAnulada, onOpenChange } = abrir()
    fireEvent.change(motivo(), { target: { value: "Error" } })
    fireEvent.click(confirmar())
    expect(await screen.findByText(mensaje)).toBeInTheDocument()
    expect(onAnulada).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("doble click: un solo pedido", async () => {
    let resolver: (v: unknown) => void = () => {}
    const fetchMock = vi.fn((url: string) =>
      String(url).startsWith("/api/caja/")
        ? Promise.resolve(respuesta(200, { sesion: { id: "s1" } }))
        : new Promise((r) => { resolver = r })
    )
    vi.stubGlobal("fetch", fetchMock)
    abrir()
    fireEvent.change(motivo(), { target: { value: "Error" } })
    const boton = confirmar()
    act(() => {
      boton.click()
      boton.click()
    })
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/anular"))).toHaveLength(1)
    await act(async () => resolver(respuesta(200, { efectivoSinEgreso: false, replayed: false })))
  })

  it("mientras anula, no se puede cancelar ni cerrar", async () => {
    let resolver: (v: unknown) => void = () => {}
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolver = r })))
    const { onOpenChange } = abrir({ nc: { ...NC, metodoReembolso: "TARJETA" } })
    fireEvent.change(motivo(), { target: { value: "Error" } })
    fireEvent.click(confirmar())
    const cancelar = await screen.findByRole("button", { name: "Cancelar" })
    expect(cancelar).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => resolver(respuesta(200, { efectivoSinEgreso: false, replayed: false })))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("devolución en efectivo sin caja abierta en la sucursal de la venta: avisa que el ingreso no entra en ningún arqueo", async () => {
    const fetchMock = vi.fn(async () => respuesta(200, { sesion: null }))
    vi.stubGlobal("fetch", fetchMock)
    abrir({ sucursalId: "suc-2" })
    expect(await screen.findByText(/No hay caja abierta en esta sucursal/)).toBeInTheDocument()
    expect(screen.getByText(/no entra en ningún arqueo/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith("/api/caja/sesiones?current=true&sucursalId=suc-2")
  })

  it("con la caja abierta no avisa nada", async () => {
    const fetchMock = vi.fn(async () => respuesta(200, { sesion: { id: "s1" } }))
    vi.stubGlobal("fetch", fetchMock)
    abrir({ sucursalId: "suc-2" })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText(/No hay caja abierta/)).not.toBeInTheDocument()
  })

  it("si el reembolso no es en efectivo, no consulta la caja", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    abrir({ nc: { ...NC, metodoReembolso: "TARJETA" }, sucursalId: "suc-2" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("si el cliente ya usó el saldo a favor, avisa que queda debiendo", () => {
    vi.stubGlobal("fetch", vi.fn())
    abrir({
      nc: { ...NC, montoReembolso: 30, metodoReembolso: "CUENTA_CORRIENTE", items: [] },
      saldoCliente: 10,
    })
    expect(screen.getByText(/queda debiendo/)).toBeInTheDocument()
  })
})
