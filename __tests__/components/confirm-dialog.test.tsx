import { describe, it, expect, vi } from "vitest"
import { useEffect } from "react"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ModalProvider, useModal } from "@/contexts/modal-context"

/**
 * ConfirmDialog es el único diálogo de confirmación/aviso de la app: absorbió a
 * AlertDialogCustom (mode="alert") y se monta sobre ResponsiveDialog, así que en
 * móvil es bottom-sheet. Estos tests fijan su contrato público, que usan ~30
 * archivos directo y ~70 vía useModal().
 */

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="¿Eliminar el cliente?"
      description="Esta acción no se puede deshacer."
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  )
  return { onOpenChange, onConfirm, onCancel }
}

describe("ConfirmDialog — mode confirm", () => {
  it("muestra título, descripción y los dos botones con los textos por defecto", () => {
    renderDialog()
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("data-mode", "confirm")
    expect(screen.getByText("¿Eliminar el cliente?")).toBeInTheDocument()
    expect(screen.getByText("Esta acción no se puede deshacer.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument()
  })

  it("se monta como ResponsiveDialog (bottom-sheet en móvil)", () => {
    renderDialog()
    expect(screen.getByRole("dialog").className).toContain("responsive-sheet")
  })

  it("confirmar llama a onConfirm y no cierra solo (el caller maneja el loading)", () => {
    const { onConfirm, onOpenChange } = renderDialog({ confirmText: "Eliminar" })
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("cancelar llama a onCancel y cierra", () => {
    const { onCancel, onOpenChange } = renderDialog()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("cancelText vacío oculta el botón secundario", () => {
    renderDialog({ cancelText: "" })
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument()
  })

  it("loading deshabilita los botones y muestra 'Procesando...'", () => {
    renderDialog({ loading: true })
    expect(screen.getByRole("button", { name: "Procesando..." })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled()
  })

  it("renderiza children entre el encabezado y los botones", () => {
    renderDialog({ children: <p>Total: $1.000</p> })
    expect(screen.getByText("Total: $1.000")).toBeInTheDocument()
  })

  it("danger usa tokens con modo oscuro, no colores crudos", () => {
    renderDialog({ variant: "danger" })
    const badge = screen.getByRole("dialog").querySelector("[data-tone]")!
    expect(badge).toHaveAttribute("data-tone", "danger")
    expect(badge.className).toContain("text-destructive")
    expect(badge.className).not.toMatch(/bg-red-100|bg-yellow-100/)
  })

  it.each([
    ["warning", "bg-warning-100"],
    ["success", "bg-success-100"],
    ["info", "bg-info-100"],
    ["default", "bg-primary-100"],
  ] as const)("tono %s → %s", (variant, clase) => {
    renderDialog({ variant })
    const badge = screen.getByRole("dialog").querySelector("[data-tone]")!
    expect(badge.className).toContain(clase)
  })
})

describe("ConfirmDialog — mode alert", () => {
  it("tiene un solo botón 'Aceptar' que cierra", () => {
    const { onOpenChange } = renderDialog({ mode: "alert", onConfirm: undefined, onCancel: undefined })
    expect(screen.getByRole("dialog")).toHaveAttribute("data-mode", "alert")
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("variant 'error' (API vieja de AlertDialogCustom) equivale a danger", () => {
    renderDialog({ mode: "alert", variant: "error" })
    expect(screen.getByRole("dialog").querySelector("[data-tone]")).toHaveAttribute("data-tone", "danger")
  })

  it("sin variant usa el tono info", () => {
    renderDialog({ mode: "alert" })
    expect(screen.getByRole("dialog").querySelector("[data-tone]")).toHaveAttribute("data-tone", "info")
  })
})

describe("useModal() sobre el ConfirmDialog unificado", () => {
  function Harness({ onReady }: { onReady: (m: ReturnType<typeof useModal>) => void }) {
    const modal = useModal()
    useEffect(() => {
      onReady(modal)
    }, [modal, onReady])
    return null
  }

  function setup() {
    let modal!: ReturnType<typeof useModal>
    render(
      <ModalProvider>
        <Harness onReady={(m) => { modal = m }} />
      </ModalProvider>,
    )
    return () => modal
  }

  it("showError abre un aviso con tono danger y resuelve al aceptar", async () => {
    const modal = setup()
    let resuelto = false
    await act(async () => {
      modal().showError("No se pudo guardar").then(() => { resuelto = true })
    })
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveAttribute("data-mode", "alert")
    expect(dialog.querySelector("[data-tone]")).toHaveAttribute("data-tone", "danger")
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }))
    await waitFor(() => expect(resuelto).toBe(true))
  })

  it("confirm resuelve false al cancelar", async () => {
    const modal = setup()
    let respuesta: boolean | null = null
    await act(async () => {
      modal().confirm({ title: "¿Seguro?", description: "x" }).then((v) => { respuesta = v })
    })
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(respuesta).toBe(false))
  })
})
