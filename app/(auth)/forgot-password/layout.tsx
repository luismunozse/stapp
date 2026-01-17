import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Recuperar Contraseña",
  description: "Recupera el acceso a tu cuenta de STApp. Te enviaremos un enlace para restablecer tu contraseña.",
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
