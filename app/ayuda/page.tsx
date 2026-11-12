import { getAllPlanPrices } from "@/lib/pricing"
import { buildPricingFaqs, getFreePlanInfo } from "@/lib/plan-copy"
import { AyudaContent } from "./ayuda-content"

// Las respuestas sobre qué incluye cada plan salen de la tabla `plans`, igual
// que la landing y /precios, para que el centro de ayuda no prometa otros
// límites.
const PLAN_QUESTIONS = new Set(["¿Qué incluye el plan Free?", "¿Qué incluye el plan Profesional?"])

export default async function AyudaPage() {
  const allPlans = await getAllPlanPrices()
  const planFaqs = buildPricingFaqs(getFreePlanInfo(allPlans), allPlans).filter((faq) =>
    PLAN_QUESTIONS.has(faq.question)
  )
  return <AyudaContent planFaqs={planFaqs} />
}
