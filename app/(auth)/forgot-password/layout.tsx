import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  description: "Recuperá el acceso a tu cuenta de STApp. Te vamos a enviar un enlace para restablecer tu contraseña.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
