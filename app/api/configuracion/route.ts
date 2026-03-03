import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadLogo, deleteLogo, dataUrlToBuffer } from "@/lib/storage"

// GET - Obtener configuración (solo ADMIN)
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: organization, error: dbError } = await supabaseAdmin
      .from("organizations")
      .select(`
        id,
        logo_url,
        logo_path,
        nombre_mostrar,
        nombre,
        email,
        telefono,
        direccion,
        moneda,
        zona_horaria,
        umbral_stock_bajo
      `)
      .eq("id", organizationId!)
      .single()

    if (dbError || !organization) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 })
    }

    // Mapear para compatibilidad con frontend
    return NextResponse.json({
      id: organization.id,
      logoUrl: organization.logo_url,
      logoData: null, // Ya no usamos base64
      logoMime: null,
      nombreEmpresa: organization.nombre_mostrar,
      nombre: organization.nombre,
      email: organization.email,
      telefono: organization.telefono,
      direccion: organization.direccion,
      moneda: organization.moneda || "ARS",
      zonaHoraria: organization.zona_horaria || "America/Argentina/Buenos_Aires",
      umbralStockBajo: organization.umbral_stock_bajo ?? 5,
    })
  } catch (error) {
    console.error("Error fetching config:", error)
    return NextResponse.json({ error: "Error al obtener configuración" }, { status: 500 })
  }
}

// PUT - Actualizar configuración (solo ADMIN)
export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { logoData, logoMime, nombreEmpresa, telefono, direccion, moneda, zonaHoraria, umbralStockBajo } = body

    const updateData: Record<string, any> = {}

    // Actualizar telefono y direccion si se proporcionan
    if (telefono !== undefined) {
      updateData.telefono = telefono || null
    }
    if (direccion !== undefined) {
      updateData.direccion = direccion || null
    }

    // Si hay nuevo logo en base64, subirlo a Storage
    if (logoData && logoMime) {
      // Validar tamaño
      const base64Size = logoData.length * 0.75
      if (base64Size > 2 * 1024 * 1024) {
        return NextResponse.json(
          { error: "La imagen es demasiado grande (máx 2MB)" },
          { status: 400 }
        )
      }

      try {
        // Construir data URL si no viene completo
        const dataUrl = logoData.startsWith("data:")
          ? logoData
          : `data:${logoMime};base64,${logoData}`

        const { buffer, mime } = dataUrlToBuffer(dataUrl)
        const { url, path } = await uploadLogo(organizationId!, buffer, mime)

        updateData.logo_url = url
        updateData.logo_path = path
      } catch (uploadError) {
        console.error("Error uploading logo:", uploadError)
        return NextResponse.json(
          { error: "Error al subir logo" },
          { status: 500 }
        )
      }
    }

    if (nombreEmpresa !== undefined) {
      updateData.nombre_mostrar = nombreEmpresa
    }

    if (moneda !== undefined) {
      const validCurrencies = ["ARS","USD","MXN","CLP","COP","PEN","UYU","BRL","BOB","PYG","EUR"]
      if (validCurrencies.includes(moneda)) {
        updateData.moneda = moneda
      }
    }

    if (zonaHoraria !== undefined && typeof zonaHoraria === "string") {
      // Validate timezone by trying to use it
      try {
        Intl.DateTimeFormat(undefined, { timeZone: zonaHoraria })
        updateData.zona_horaria = zonaHoraria
      } catch {
        // Invalid timezone, ignore
      }
    }

    if (umbralStockBajo !== undefined) {
      const val = parseInt(umbralStockBajo)
      if (!isNaN(val) && val >= 0) {
        updateData.umbral_stock_bajo = val
      }
    }

    // Solo actualizar si hay cambios
    if (Object.keys(updateData).length === 0) {
      // Retornar estado actual
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("id, logo_url, nombre_mostrar, telefono, direccion, moneda, zona_horaria, umbral_stock_bajo")
        .eq("id", organizationId!)
        .single()

      return NextResponse.json({
        id: org?.id,
        logoUrl: org?.logo_url,
        nombreEmpresa: org?.nombre_mostrar,
        telefono: org?.telefono,
        direccion: org?.direccion,
        moneda: org?.moneda || "ARS",
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
        umbralStockBajo: org?.umbral_stock_bajo ?? 5,
      })
    }

    const { data: organization, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update(updateData)
      .eq("id", organizationId!)
      .select("id, logo_url, logo_path, nombre_mostrar, telefono, direccion, moneda, zona_horaria, umbral_stock_bajo")
      .single()

    if (dbError) {
      throw dbError
    }

    return NextResponse.json({
      id: organization.id,
      logoUrl: organization.logo_url,
      nombreEmpresa: organization.nombre_mostrar,
      telefono: organization.telefono,
      direccion: organization.direccion,
      moneda: organization.moneda || "ARS",
      zonaHoraria: organization.zona_horaria || "America/Argentina/Buenos_Aires",
      umbralStockBajo: organization.umbral_stock_bajo ?? 5,
    })
  } catch (error) {
    console.error("Error updating config:", error)
    return NextResponse.json({ error: "Error al actualizar configuración" }, { status: 500 })
  }
}

// DELETE - Eliminar logo (solo ADMIN)
export async function DELETE() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Eliminar de Storage
    await deleteLogo(organizationId!)

    // Actualizar DB
    const { data: organization, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({
        logo_url: null,
        logo_path: null,
      })
      .eq("id", organizationId!)
      .select("id, logo_url, nombre_mostrar")
      .single()

    if (dbError) {
      throw dbError
    }

    return NextResponse.json({
      id: organization.id,
      logoUrl: null,
      nombreEmpresa: organization.nombre_mostrar,
    })
  } catch (error) {
    console.error("Error deleting logo:", error)
    return NextResponse.json({ error: "Error al eliminar logo" }, { status: 500 })
  }
}
