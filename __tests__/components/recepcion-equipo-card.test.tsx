/**
 * RecepcionEquipoCard reemplazo el input bare de "Codigo de acceso" por
 * CodigoAccesoModal (ver codigo-acceso-modal.tsx): boton "Agregar codigo de
 * acceso" cuando esta vacio, chip enmascarado + boton de limpiar cuando tiene
 * valor. Este test cubre ese contrato de UI sin montar RecepcionForm entero
 * (register viene de un useForm() minimo, los demas props son callbacks
 * mockeados) -- los tipos de dispositivo se pasan vacios a proposito: sin
 * match, useTipoDispositivoConfig cae al FALLBACK_CONFIG (showPassword true),
 * que es lo unico que a esta card le importa para decidir si mostrar el
 * campo.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { RecepcionEquipoCard } from "@/components/ordenes/recepcion-equipo-card"
import type { FotoPreview } from "@/components/ordenes/fotos-ingreso"

function Harness({
  codigoAcceso,
  onCodigoAccesoChange = vi.fn(),
}: {
  codigoAcceso: string
  onCodigoAccesoChange?: (v: string) => void
}) {
  const { register } = useForm()
  const fotos: FotoPreview[] = []
  return (
    <RecepcionEquipoCard
      index={0}
      tipos={[]}
      tiposLoading={false}
      tipoSeleccionado="CELULAR"
      onTipoChange={() => {}}
      register={register}
      puedeQuitar={false}
      onQuitar={() => {}}
      accesoriosSeleccionados={[]}
      onToggleAccesorio={() => {}}
      otroAccesorio=""
      onOtroAccesorioChange={() => {}}
      onOtroAccesorioAdd={() => {}}
      camposExtraValues={{}}
      onCampoExtraChange={() => {}}
      onProblemaQuickSelect={() => {}}
      fotos={fotos}
      comprimiendo={false}
      onFileChange={() => {}}
      onRemoveFoto={() => {}}
      onFotoDescripcionChange={() => {}}
      labelFotos="Fotos"
      codigoAcceso={codigoAcceso}
      onCodigoAccesoChange={onCodigoAccesoChange}
    />
  )
}

describe("RecepcionEquipoCard — codigo de acceso", () => {
  it("con valor vacio muestra el boton 'Agregar código de acceso' (sin input bare)", () => {
    render(<Harness codigoAcceso="" />)
    expect(screen.getByRole("button", { name: /Agregar código de acceso/i })).toBeInTheDocument()
    // El dialogo no esta abierto todavia.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("con un codigo numerico muestra el chip enmascarado 'PIN ••••'", () => {
    render(<Harness codigoAcceso="1234" />)
    expect(screen.getByText("PIN ••••")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Agregar código de acceso/i })).not.toBeInTheDocument()
  })

  it("con una contrasena muestra el chip enmascarado 'Contraseña ••••••'", () => {
    render(<Harness codigoAcceso="hunter2" />)
    expect(screen.getByText("Contraseña ••••••")).toBeInTheDocument()
  })

  it("con un patron muestra el chip sin enmascarar (patrones no son secretos en esta app)", () => {
    render(<Harness codigoAcceso="Patrón: 1-2-5-9" />)
    expect(screen.getByText("Patrón: 1-2-5-9")).toBeInTheDocument()
  })

  it("el boton X limpia el valor via onCodigoAccesoChange('') sin abrir el modal", () => {
    const onCodigoAccesoChange = vi.fn()
    render(<Harness codigoAcceso="1234" onCodigoAccesoChange={onCodigoAccesoChange} />)

    fireEvent.click(screen.getByRole("button", { name: /Quitar código de acceso/i }))

    expect(onCodigoAccesoChange).toHaveBeenCalledWith("")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("clickear el chip abre el modal de edicion", () => {
    render(<Harness codigoAcceso="1234" />)
    fireEvent.click(screen.getByRole("button", { name: /Editar código de acceso/i }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Código de acceso" })).toBeInTheDocument()
  })

  it("clickear 'Agregar código de acceso' abre el modal", () => {
    render(<Harness codigoAcceso="" />)
    fireEvent.click(screen.getByRole("button", { name: /Agregar código de acceso/i }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
