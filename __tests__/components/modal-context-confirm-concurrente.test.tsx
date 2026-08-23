import { describe, it, expect, vi, beforeEach } from "vitest"
import { useEffect } from "react"
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider, useModal } from "@/contexts/modal-context"

/**
 * ModalProvider tiene UN diálogo y UN resolver. Un segundo confirm() que llega
 * con el primero sin contestar lo pisaba en el lugar, y la promesa del primero
 * quedaba colgada para siempre: el `await` de quien preguntó no volvía nunca.
 *
 * No es teórico. Cualquier confirm que salga de un callback asíncrono puede
 * caer en cualquier momento, incluso arriba de un diálogo que el operador ya
 * tiene abierto, y lo que se pierde es la acción que él SÍ pidió — en silencio,
 * sin error ni nada en pantalla.
 *
 * Arreglo mínimo y en la dirección segura: al llegar un confirm nuevo, el
 * anterior se contesta `false`, exactamente lo mismo que ya devuelven ESC y el
 * click en el overlay. Encolarlos sería más fiel, pero apila diálogos sobre un
 * operador que ya perdió el contexto de la primera pregunta; contestar que no
 * cancela la acción pendiente, que es lo que un usuario espera cuando su
 * diálogo desaparece de la pantalla.
 */

function Harness({ onReady }: { onReady: (confirmar: ReturnType<typeof useModal>["confirm"]) => void }) {
  const { confirm } = useModal()
  useEffect(() => {
    onReady(confirm)
  }, [confirm, onReady])
  return null
}

describe("ModalProvider — dos confirm() concurrentes", () => {
  let confirmar: ReturnType<typeof useModal>["confirm"]

  beforeEach(() => {
    vi.clearAllMocks()
    render(
      <ModalProvider>
        <Harness onReady={(c) => { confirmar = c }} />
      </ModalProvider>,
    )
  })

  it("no deja colgada la promesa del primero", async () => {
    let primera: boolean | "sin contestar" = "sin contestar"

    await act(async () => {
      confirmar({ title: "Primera", description: "primera" }).then((v) => { primera = v })
    })
    await act(async () => {
      confirmar({ title: "Segunda", description: "segunda" })
    })

    expect(primera).toBe(false)
  })

  it("la contesta que no, que es lo mismo que un ESC", async () => {
    let primera: boolean | "sin contestar" = "sin contestar"

    await act(async () => {
      confirmar({ title: "Primera", description: "primera" }).then((v) => { primera = v })
    })
    await act(async () => {
      confirmar({ title: "Segunda", description: "segunda" })
    })

    expect(primera).not.toBe(true)
  })

  it("el segundo sigue funcionando normalmente", async () => {
    let segunda: boolean | "sin contestar" = "sin contestar"

    await act(async () => {
      confirmar({ title: "Primera", description: "primera" })
    })
    await act(async () => {
      confirmar({ title: "Segunda", description: "segunda", confirmText: "Dale" }).then((v) => {
        segunda = v
      })
    })

    fireEvent.click(await screen.findByRole("button", { name: "Dale" }))

    await waitFor(() => expect(segunda).toBe(true))
  })

  it("un confirm solo, sin competencia, se comporta igual que siempre", async () => {
    let unica: boolean | "sin contestar" = "sin contestar"

    await act(async () => {
      confirmar({ title: "Única", description: "única", confirmText: "Aceptar" }).then((v) => {
        unica = v
      })
    })

    fireEvent.click(await screen.findByRole("button", { name: "Aceptar" }))

    await waitFor(() => expect(unica).toBe(true))
  })
})
