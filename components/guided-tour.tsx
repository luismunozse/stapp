"use client"

import { useEffect, useCallback, useRef } from "react"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"
import { tourSteps, TOUR_STORAGE_KEY } from "@/lib/tour-config"

export function GuidedTour() {
  const hasStarted = useRef(false)

  const startTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      showButtons: ["next", "previous", "close"],
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "¡Entendido!",
      progressText: "{{current}} de {{total}}",
      steps: tourSteps,
      onDestroyStarted: () => {
        localStorage.setItem(TOUR_STORAGE_KEY, "true")
        driverObj.destroy()
      },
    })
    driverObj.drive()
  }, [])

  // Auto-iniciar el tour la primera vez
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    const completed = localStorage.getItem(TOUR_STORAGE_KEY)
    if (completed) return

    // Esperar a que el sidebar se renderice
    const timeout = setTimeout(() => {
      const firstStep = document.querySelector("#nav-dashboard")
      if (firstStep) {
        startTour()
      }
    }, 800)

    return () => clearTimeout(timeout)
  }, [startTour])

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
