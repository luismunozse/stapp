import { serve } from "inngest/next"
import { inngest, functions } from "@/lib/inngest"

// Crear handler de Inngest para Next.js
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
})
