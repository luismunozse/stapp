import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isPremium } from "@/lib/subscriptions"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json({ error: "Requiere plan Premium", code: "PREMIUM_REQUIRED" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const tipoDispositivo = searchParams.get("tipo") || null

    // Obtener problemas reportados y diagnósticos
    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select("problema_reportado, diagnostico, tipo_dispositivo")
      .eq("organization_id", organizationId!)

    if (tipoDispositivo) {
      query = query.eq("tipo_dispositivo", tipoDispositivo)
    }

    const { data: ordenes } = await query

    if (!ordenes || ordenes.length === 0) {
      return NextResponse.json({ data: [], total: 0 })
    }

    // Análisis de palabras clave en problemas
    const keywords: Record<string, number> = {}
    const stopWords = new Set([
      "de", "la", "el", "en", "y", "no", "se", "que", "un", "una",
      "los", "las", "del", "al", "es", "por", "con", "su", "para",
      "lo", "le", "da", "ya", "o", "a", "muy", "mas", "pero", "si",
    ])

    // Patrones comunes de fallas
    const patterns: Record<string, RegExp> = {
      "Pantalla rota": /pantalla\s*(rota|rajada|quebrada|fisurada|estrellada)/i,
      "No enciende": /no\s*(enciende|prende|arranca|inicia)/i,
      "Batería": /bater[ií]a\s*(hinchada|descarga|no\s*carga|dura\s*poco|degradada)/i,
      "No carga": /(no\s*carga|puerto\s*de\s*carga|pin\s*de\s*carga|flex\s*de\s*carga)/i,
      "Pantalla con fallas": /pantalla\s*(parpadea|manchas|lineas|pixeles|fantasma|negra)/i,
      "Mojado / Humedad": /(mojado|mojó|humedad|agua|líquido|se\s*cayó\s*al\s*agua)/i,
      "Software": /(software|sistema|virus|lento|reinicia|cuelga|traba)/i,
      "Botones": /(bot[oó]n|botones)\s*(no\s*funciona|roto|trabado|hundido)/i,
      "Cámara": /c[aá]mara\s*(no\s*funciona|borrosa|rota|empañada)/i,
      "Audio": /(altavoz|parlante|auricular|micr[oó]fono|no\s*se\s*escucha|sin\s*sonido)/i,
    }

    const patternCounts: Record<string, number> = {}

    for (const orden of ordenes) {
      const texto = `${orden.problema_reportado || ""} ${orden.diagnostico || ""}`.toLowerCase()

      for (const [nombre, regex] of Object.entries(patterns)) {
        if (regex.test(texto)) {
          patternCounts[nombre] = (patternCounts[nombre] || 0) + 1
        }
      }
    }

    const data = Object.entries(patternCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([falla, cantidad]) => ({
        falla,
        cantidad,
        porcentaje: Math.round((cantidad / ordenes.length) * 100),
      }))

    return NextResponse.json({ data, total: ordenes.length })
  } catch (err) {
    console.error("Error en reporte fallas-comunes:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
