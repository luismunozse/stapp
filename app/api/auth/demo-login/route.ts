import { NextResponse } from "next/server"
import { signIn } from "@/lib/auth"

export async function POST() {
  try {
    // Credenciales de la cuenta demo
    // Estas credenciales deben coincidir con la cuenta creada en Supabase
    const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@stapp.com"
    const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo2024!"

    // Intentar iniciar sesión con las credenciales demo
    const result = await signIn("credentials", {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      rememberMe: "false", // No recordar sesión demo
      redirect: false,
    })

    if (!result || result.error) {
      return NextResponse.json(
        {
          error: "No se pudo iniciar sesión con la cuenta demo. Verifica que la cuenta esté configurada en Supabase."
        },
        { status: 401 }
      )
    }

    // Login exitoso
    return NextResponse.json({
      success: true,
      message: "Sesión demo iniciada correctamente",
      redirectUrl: "/dashboard"
    })
  } catch (error) {
    console.error("Error en demo login:", error)
    return NextResponse.json(
      { error: "Error al iniciar sesión demo" },
      { status: 500 }
    )
  }
}
