import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/lib/auth-utils"
import { assertSucursalEnOrg, SUCURSAL_COOKIE } from "@/lib/sucursal"
import { z } from "zod"

const schema = z.object({
  // "todas" => limpia el filtro (admin ve todas); un id => fija esa sucursal.
  sucursalId: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    // Solo ADMIN cambia de sucursal activa; el resto está atado a la suya.
    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const body = await request.json()
    const { sucursalId } = schema.parse(body)

    if (sucursalId !== "todas") {
      const ok = await assertSucursalEnOrg(sucursalId, organizationId!)
      if (!ok) {
        return NextResponse.json({ error: "Sucursal inválida" }, { status: 400 })
      }
    }

    const store = await cookies()
    store.set(SUCURSAL_COOKIE, sucursalId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    })

    return NextResponse.json({ success: true, sucursalId })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error set sucursal activa:", err)
    return NextResponse.json({ error: "Error al cambiar de sucursal" }, { status: 500 })
  }
}
