import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: vendedor, error: dbError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        nombre,
        email,
        created_at,
        ventas (
          id,
          total,
          estado,
          created_at
        )
      `)
      .eq("id", id)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    const ventas = vendedor.ventas || []
    const ventasCompletadas = ventas.filter((v: any) => v.estado === "COMPLETADA")

    return NextResponse.json({
      id: vendedor.id,
      nombre: vendedor.nombre,
      email: vendedor.email,
      createdAt: vendedor.created_at,
      ventasCompletadas: ventasCompletadas.length,
      ventasTotal: ventas.length,
      montoTotalVentas: ventasCompletadas.reduce(
        (sum: number, v: any) => sum + parseFloat(v.total || "0"),
        0
      ),
      ventas: ventas
        .sort((a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .map((v: any) => ({
          id: v.id,
          total: v.total,
          estado: v.estado,
          fecha: v.created_at,
        })),
    })
  } catch (error) {
    console.error("Error fetching vendedor:", error)
    return NextResponse.json(
      { error: "Error al obtener vendedor" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const { nombre, email, password } = body

    // Verificar que el vendedor existe
    const { data: vendedor, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("id", id)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    // Verificar email único si cambió
    if (email && email !== vendedor.email) {
      const { data: existingUser } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("email", email)
        .single()

      if (existingUser) {
        return NextResponse.json(
          { error: "Ya existe un usuario con este email" },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, any> = {}
    if (nombre) updateData.nombre = nombre
    if (email) updateData.email = email
    if (password) updateData.password = await bcrypt.hash(password, 10)

    const { data: updatedVendedor, error: updateError } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select("id, nombre, email")
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(updatedVendedor)
  } catch (error) {
    console.error("Error updating vendedor:", error)
    return NextResponse.json(
      { error: "Error al actualizar vendedor" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Verificar que el vendedor existe y obtener ventas asociadas
    const { data: vendedor, error: fetchError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        ventas (
          id,
          estado
        )
      `)
      .eq("id", id)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    // No permitir eliminar si tiene ventas asociadas
    const ventas = vendedor.ventas || []
    if (ventas.length > 0) {
      return NextResponse.json(
        { error: `No se puede eliminar un vendedor con ${ventas.length} venta(s) asociada(s). Reasigne las ventas primero.` },
        { status: 400 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", id)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ message: "Vendedor eliminado correctamente" })
  } catch (error) {
    console.error("Error deleting vendedor:", error)
    return NextResponse.json(
      { error: "Error al eliminar vendedor" },
      { status: 500 }
    )
  }
}
