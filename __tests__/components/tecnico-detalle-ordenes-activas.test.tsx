/**
 * The technician detail page (change sucursales-aislamiento, PR5b). Deactivating or deleting a technician is
 * a GLOBAL action, so what warns about it counts every open order he holds in every branch
 * (`ordenesActivasTotal`); `ordenesActivas` is the part in the scope the ADMIN works in, which is what the
 * reassignment dialog moves. The jed-electronics case: a technician of San Justo holds seven open orders
 * of Tablada, and an ADMIN on San Justo looks at him.
 */
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const confirmar = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "admin-1", role: "ADMIN" } } }) }))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm: confirmar, showError: vi.fn() }) }))
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ timezone: "America/Argentina/Buenos_Aires" }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/tecnicos/tecnico-form", () => ({ TecnicoForm: () => null }))
vi.mock("@/components/tecnicos/tecnico-comisiones", () => ({ TecnicoComisiones: () => null }))
vi.mock("@/components/tecnicos/tecnico-insights", () => ({ TecnicoInsights: () => null }))
vi.mock("@/components/tecnicos/tecnico-historial", () => ({ TecnicoHistorial: () => null }))
vi.mock("@/components/tecnicos/horario-laboral-editor", () => ({ HorarioLaboralEditor: () => null }))
vi.mock("@/components/tecnicos/reasignar-ordenes-dialog", () => ({
  ReasignarOrdenesDialog: ({ open, ordenesActivas, ordenesActivasTotal }: { open: boolean; ordenesActivas: number; ordenesActivasTotal?: number }) =>
    open ? <div data-testid="dialogo-reasignar">{`${ordenesActivas}/${ordenesActivasTotal}`}</div> : null,
}))

import TecnicoDetallePage from "@/app/(dashboard)/tecnicos/[id]/page"

const detalle = (extra: Record<string, unknown> = {}) => ({
  id: "t-jed",
  nombre: "Jed",
  email: "jed@x.com",
  activo: true,
  especialidades: [],
  createdAt: "2026-01-01T00:00:00Z",
  ordenesCompletadas: 4,
  ordenesActivas: 0,
  ordenesActivasTotal: 7,
  ...extra,
})

let respuesta: Record<string, unknown>

/** The page reads its params with `use()`: an already resolved thenable does not suspend. */
const parametros = () => Object.assign(Promise.resolve({ id: "t-jed" }), { status: "fulfilled" as const, value: { id: "t-jed" } })

async function montar(cuerpo: Record<string, unknown>) {
  respuesta = cuerpo
  render(<TecnicoDetallePage params={parametros()} />)
  await screen.findByText("Detalle del técnico")
}

const botonEliminar = () => screen.getAllByRole("button", { name: /Eliminar/ })[0] as HTMLButtonElement
const descripcionDelConfirm = () => (confirmar.mock.calls[0]?.[0] as { description: string }).description

describe("technician detail: the open orders that gate a global action", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmar.mockResolvedValue(false)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => respuesta } as Response)),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  describe("jed-electronics: nothing of his is handled in this scope, but he holds seven open orders elsewhere", () => {
    beforeEach(async () => {
      await montar(detalle({ ordenesActivas: 0, ordenesActivasTotal: 7 }))
    })

    it("the reassign button is there: there is work to move, from the other branch", () => {
      expect(screen.getByRole("button", { name: /Reasignar órdenes/ })).toBeInTheDocument()
    })

    it("deactivating warns about the seven orders and says they belong to other branches", async () => {
      fireEvent.click(screen.getByRole("button", { name: "Desactivar" }))
      await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
      expect(descripcionDelConfirm()).toBe(
        "El técnico dejará de recibir asignaciones nuevas. Aún tiene 7 orden(es) activa(s), todas de otras sucursales. Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector.",
      )
    })

    it("he cannot be deleted while he holds them, with the reason on the button", () => {
      expect(botonEliminar()).toBeDisabled()
      expect(botonEliminar()).toHaveAttribute("title", "No se puede eliminar con órdenes activas")
    })

    it("the dialog gets both numbers: what moves in this scope and the total", () => {
      fireEvent.click(screen.getByRole("button", { name: /Reasignar órdenes/ }))
      expect(screen.getByTestId("dialogo-reasignar")).toHaveTextContent("0/7")
    })
  })

  describe("some of the orders here and some elsewhere", () => {
    it("deactivating says how many of each", async () => {
      await montar(detalle({ ordenesActivas: 2, ordenesActivasTotal: 5 }))
      fireEvent.click(screen.getByRole("button", { name: "Desactivar" }))
      await waitFor(() => expect(confirmar).toHaveBeenCalled())
      expect(descripcionDelConfirm()).toBe(
        "El técnico dejará de recibir asignaciones nuevas. Aún tiene 5 orden(es) activa(s) (2 de esta sucursal y 3 de otras). Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector.",
      )
    })
  })

  describe("all of them in this scope (or on Todas)", () => {
    it("the plain warning, as before", async () => {
      await montar(detalle({ ordenesActivas: 3, ordenesActivasTotal: 3 }))
      fireEvent.click(screen.getByRole("button", { name: "Desactivar" }))
      await waitFor(() => expect(confirmar).toHaveBeenCalled())
      expect(descripcionDelConfirm()).toBe("El técnico dejará de recibir asignaciones nuevas. Aún tiene 3 orden(es) activa(s). Considerá reasignarlas.")
      expect(botonEliminar()).toBeDisabled()
    })
  })

  describe("no open order anywhere", () => {
    beforeEach(async () => {
      await montar(detalle({ ordenesActivas: 0, ordenesActivasTotal: 0 }))
    })

    it("no reassign button, no warning, and he can be deleted", async () => {
      expect(screen.queryByRole("button", { name: /Reasignar órdenes/ })).not.toBeInTheDocument()
      expect(botonEliminar()).not.toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: "Desactivar" }))
      await waitFor(() => expect(confirmar).toHaveBeenCalled())
      expect(descripcionDelConfirm()).toBe("El técnico dejará de recibir asignaciones nuevas.")
    })
  })

  describe("an answer without the total (an older server)", () => {
    it("falls back to the scoped count, as the page always did", async () => {
      await montar(detalle({ ordenesActivas: 3, ordenesActivasTotal: undefined }))
      expect(screen.getByRole("button", { name: /Reasignar órdenes/ })).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "Desactivar" }))
      await waitFor(() => expect(confirmar).toHaveBeenCalled())
      expect(descripcionDelConfirm()).toContain("Aún tiene 3 orden(es) activa(s). Considerá reasignarlas.")
    })
  })

  it("reactivating an inactive technician has no warning at all", async () => {
    await montar(detalle({ activo: false, ordenesActivas: 0, ordenesActivasTotal: 7 }))
    fireEvent.click(screen.getByRole("button", { name: "Reactivar" }))
    await waitFor(() => expect(confirmar).toHaveBeenCalled())
    expect(descripcionDelConfirm()).toBe("El técnico volverá a poder recibir asignaciones.")
  })
})
