import { NextResponse } from "next/server"

interface CotizacionDolar {
  moneda: string
  casa: string
  nombre: string
  compra: number
  venta: number
  fechaActualizacion: string
}

// Cache en memoria con TTL de 5 minutos
let cachedData: CotizacionDolar[] | null = null
let cacheTimestamp: number = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutos

export async function GET() {
  try {
    const now = Date.now()

    // Retornar datos cacheados si son válidos
    if (cachedData && now - cacheTimestamp < CACHE_TTL) {
      return NextResponse.json(cachedData, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
          "X-Cache": "HIT",
        },
      })
    }

    // Fetch de la API externa
    const response = await fetch("https://dolarapi.com/v1/dolares", {
      next: { revalidate: 300 }, // Revalidate cada 5 minutos
    })

    if (!response.ok) {
      // Si tenemos cache viejo, usarlo como fallback
      if (cachedData) {
        return NextResponse.json(cachedData, {
          headers: {
            "Cache-Control": "public, s-maxage=60",
            "X-Cache": "STALE",
          },
        })
      }
      throw new Error("Error al obtener cotizaciones")
    }

    const data: CotizacionDolar[] = await response.json()

    // Actualizar cache
    cachedData = data
    cacheTimestamp = now

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        "X-Cache": "MISS",
      },
    })
  } catch (error) {
    console.error("Error fetching cotización dólar:", error)

    // Fallback a cache si existe
    if (cachedData) {
      return NextResponse.json(cachedData, {
        headers: {
          "Cache-Control": "public, s-maxage=60",
          "X-Cache": "ERROR-FALLBACK",
        },
      })
    }

    return NextResponse.json(
      { error: "No se pudieron obtener las cotizaciones" },
      { status: 500 }
    )
  }
}
