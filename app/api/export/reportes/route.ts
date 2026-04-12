import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "data_export")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "La exportación de reportes requiere el plan Profesional", code: "FEATURE_REQUIRED", feature: "data_export" },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")
    const format = searchParams.get("format") || "csv"

    if (!type) {
      return NextResponse.json({ error: "type es requerido" }, { status: 400 })
    }

    // Fetch the report data from the corresponding endpoint
    const baseUrl = new URL(request.url).origin
    const reportUrl = `${baseUrl}/api/reportes/${type}`

    const reportRes = await fetch(reportUrl, {
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
    })

    if (!reportRes.ok) {
      return NextResponse.json(
        { error: "Error al obtener datos del reporte" },
        { status: 500 }
      )
    }

    const data = await reportRes.json()

    if (format === "csv") {
      const csv = jsonToCsv(data)
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="reporte-${type}-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      })
    }

    // PDF: return a simple text-based report
    const text = jsonToText(data, type)
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="reporte-${type}-${new Date().toISOString().split("T")[0]}.txt"`,
      },
    })
  } catch (err) {
    console.error("Error exporting report:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

function jsonToCsv(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return ""
    const headers = Object.keys(data[0])
    const rows = data.map((row) =>
      headers.map((h) => {
        const val = (row as Record<string, unknown>)[h]
        const str = val === null || val === undefined ? "" : String(val)
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str
      }).join(",")
    )
    return [headers.join(","), ...rows].join("\n")
  }

  // If data is an object with nested arrays, try to flatten
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>
    // Look for the first array property
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        return jsonToCsv(obj[key])
      }
    }
    // Single object: convert to key-value CSV
    const entries = Object.entries(obj)
    return entries.map(([k, v]) => `${k},${v}`).join("\n")
  }

  return String(data)
}

function jsonToText(data: unknown, type: string): string {
  const lines: string[] = []
  lines.push(`Reporte: ${type}`)
  lines.push(`Fecha: ${new Date().toLocaleDateString("es-AR")}`)
  lines.push("=".repeat(50))
  lines.push("")

  if (Array.isArray(data)) {
    data.forEach((item, i) => {
      lines.push(`--- Item ${i + 1} ---`)
      for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
        lines.push(`  ${key}: ${val}`)
      }
      lines.push("")
    })
  } else if (typeof data === "object" && data !== null) {
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        lines.push(`${key}:`)
        val.forEach((item, i) => {
          lines.push(`  [${i + 1}] ${JSON.stringify(item)}`)
        })
      } else {
        lines.push(`${key}: ${val}`)
      }
    }
  }

  return lines.join("\n")
}
