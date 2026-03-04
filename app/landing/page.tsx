import { permanentRedirect } from "next/navigation"

// Redirect permanente (301) /landing -> / para evitar contenido duplicado SEO
// La URL canonica de la landing es la raiz /
export default function LandingRedirect() {
  permanentRedirect("/")
}
