import { NextResponse } from "next/server"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"

export async function GET() {
  try {
    // Verificar que el APK existe obteniendo su metadata
    const { data: metadataFile } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.APK_RELEASES)
      .download("metadata.json")

    if (!metadataFile) {
      return NextResponse.json(
        { error: "APK no disponible aún" },
        { status: 404 }
      )
    }

    const metadata = JSON.parse(await metadataFile.text())

    // Generar URL firmada con expiración de 1 hora
    const { data: signedUrl, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.APK_RELEASES)
      .createSignedUrl("stapp-latest.apk", 3600, {
        download: "STApp.apk",
      })

    if (error || !signedUrl) {
      return NextResponse.json(
        { error: "Error generando enlace de descarga" },
        { status: 500 }
      )
    }

    // Redirigir al URL firmado
    return NextResponse.redirect(signedUrl.signedUrl)
  } catch {
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
