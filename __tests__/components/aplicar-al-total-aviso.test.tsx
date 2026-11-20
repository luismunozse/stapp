import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { OrdenRepuestosTab } from "@/components/ordenes/orden-repuestos-tab"

// Los repuestos suman al monto de la orden igual que los servicios (migración
// 420): si el costo final no los incluye, la pestaña Repuestos ofrece
// "Aplicar al total".
const repuesto = { id: "r1", nombre: "Pantalla", cantidad: 1, precioUnitario: 100000, precioVentaUnitario: 299100 }
const servicios = [{ cantidad: 1, precioUnitario: 250000 }]

function renderTab(props: { costoFinal: number | null; estado?: string; mostrarCostos?: boolean }) {
  return render(
    <ModalProvider>
      <OrdenRepuestosTab
        ordenId="orden-1"
        repuestos={[repuesto]}
        mostrarCostos={props.mostrarCostos ?? true}
        ordenEstado={props.estado ?? "REPARADO"}
        onRepuestosChanged={vi.fn()}
        montos={{ presupuesto: null, costoFinal: props.costoFinal, totalCobrado: 0, servicios }}
      />
    </ModalProvider>,
  )
}

describe("aviso Aplicar al total en la pestaña Repuestos", () => {
  it("aparece si el costo final no incluye los repuestos", () => {
    renderTab({ costoFinal: 250000 })
    expect(screen.getByText(/no coincide con servicios \+ repuestos/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Aplicar al total" })).toBeTruthy()
  })

  it("no aparece si el costo final ya es servicios + repuestos", () => {
    renderTab({ costoFinal: 549100 })
    expect(screen.queryByRole("button", { name: "Aplicar al total" })).toBeNull()
  })

  it("no aparece en una orden entregada (ya no se sincroniza)", () => {
    renderTab({ costoFinal: 250000, estado: "ENTREGADO" })
    expect(screen.queryByRole("button", { name: "Aplicar al total" })).toBeNull()
  })

  it("no aparece sin permiso para ver costos", () => {
    renderTab({ costoFinal: 250000, mostrarCostos: false })
    expect(screen.queryByRole("button", { name: "Aplicar al total" })).toBeNull()
  })
})
