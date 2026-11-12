"use client"

import { useEffect, useCallback, useRef, useState } from "react"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"
import { tourSteps, TOUR_STORAGE_KEY } from "@/lib/tour-config"
import { useCapaPrioritaria } from "@/hooks/use-capa-prioritaria"

export function GuidedTour() {
  const hasStarted = useRef(false)

  const startTour = useCallback(() => {
    // Filtrar pasos cuyos elementos existen en el DOM (depende del rol del usuario)
    const visibleSteps = tourSteps.filter(
      (step) => !step.element || document.querySelector(step.element as string)
    )

    if (visibleSteps.length === 0) return

    const driverObj = driver({
      showProgress: true,
      showButtons: ["next", "previous", "close"],
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "¡Entendido!",
      progressText: "{{current}} de {{total}}",
      steps: visibleSteps,
      onDestroyStarted: () => {
        localStorage.setItem(TOUR_STORAGE_KEY, "true")
        driverObj.destroy()
      },
    })
    driverObj.drive()
  }, [])

  // Se postula al orquestador recién cuando sabe que puede arrancar: no lo
  // completó y el sidebar ya está en el DOM. Así no gana la sesión un tour
  // que después no se puede mostrar.
  const [listo, setListo] = useState(false)
  // Una sola capa de primer ingreso por sesión (auditoría UX §5.1).
  const permitido = useCapaPrioritaria("tour", listo)

  useEffect(() => {
    let completed: string | null = null
    try {
      completed = localStorage.getItem(TOUR_STORAGE_KEY)
    } catch {
      // sin storage: se trata como no completado
    }
    if (completed) return

    // Esperar a que el sidebar se renderice
    const timeout = setTimeout(() => {
      if (document.querySelector("#nav-dashboard")) setListo(true)
    }, 800)

    return () => clearTimeout(timeout)
  }, [])

  // Auto-iniciar el tour la primera vez, si el orquestador le dio el turno
  useEffect(() => {
    if (!permitido || hasStarted.current) return
    hasStarted.current = true
    startTour()
  }, [permitido, startTour])

  // Escuchar evento custom para relanzar el tour desde el navbar
  useEffect(() => {
    const handler = () => {
      localStorage.removeItem(TOUR_STORAGE_KEY)
      startTour()
    }
    window.addEventListener("start-tour", handler)
    return () => window.removeEventListener("start-tour", handler)
  }, [startTour])

  return null
}
