import { NextResponse } from "next/server"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"

export async function GET() {
  try {
    const { data: metadataFile } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.APK_RELEASES)
      .download("metadata.json")

    if (!metadataFile) {
      return NextResponse.json({ available: false })
    }

    const metadata = JSON.parse(await metadataFile.text())

    return NextResponse.json({
      available: true,
      ...metadata,
    })
  } catch {
    return NextResponse.json({ available: false })
  }
}
