"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const faqs = [
  {
    question: "¿Necesito instalar algo en mi computadora?",
    answer:
      "No, STApp es una aplicación web que funciona en tu navegador. Solo necesitas conexión a internet. También puedes instalarlo como app en tu celular (PWA).",
  },
  {
    question: "¿Puedo probar antes de pagar?",
    answer:
      "¡Claro! El plan Free es completamente gratuito y puedes usarlo el tiempo que quieras. Cuando necesites más capacidad, puedes actualizar a Premium.",
  },
  {
    question: "¿Qué métodos de pago aceptan?",
    answer:
      "Aceptamos tarjetas de crédito, débito, efectivo y otros medios de pago a través de MercadoPago.",
  },
  {
    question: "¿Puedo cancelar mi suscripción en cualquier momento?",
    answer:
      "Sí, puedes cancelar cuando quieras. Mantendrás el acceso a las funciones Premium hasta el final del período facturado. No hay penalidades ni cargos ocultos.",
  },
  {
    question: "¿Mis datos están seguros?",
    answer:
      "Absolutamente. Usamos encriptación de nivel bancario, backups automáticos diarios y cumplimos con las mejores prácticas de seguridad. Tus datos están protegidos 24/7.",
  },
  {
    question: "¿Puedo importar mis datos de otro sistema?",
    answer:
      "Sí, ofrecemos importación de datos desde Excel/CSV. Si tienes un sistema anterior, nuestro equipo de soporte puede ayudarte con la migración.",
  },
  {
    question: "¿Hay soporte en español?",
    answer:
      "Sí, todo el sistema está en español y nuestro equipo de soporte también. Estamos disponibles por email y chat para ayudarte con cualquier duda.",
  },
  {
    question: "¿Pueden agregar funciones que necesito?",
    answer:
      "Estamos constantemente mejorando el sistema basándonos en feedback de usuarios. Escuchamos las sugerencias y muchas funciones nuevas vienen de nuestros clientes.",
  },
]

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section id="faq" className="py-6 sm:py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Preguntas frecuentes
          </h2>
          <p className="text-lg text-gray-600">
            ¿Tienes dudas? Aquí encontrarás las respuestas a las preguntas más
            comunes.
          </p>
        </div>

        {/* FAQ list */}
        <div className="max-w-3xl mx-auto">
          {faqs.map((faq, index) => (
            <div key={index} className="border-b">
              <button
                type="button"
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="flex items-center justify-between w-full py-5 text-left"
              >
                <span className="font-medium text-gray-900">{faq.question}</span>
                <ChevronDown
                  className={cn(
                    "w-5 h-5 text-gray-500 transition-transform",
                    openIndex === index && "rotate-180"
                  )}
                />
              </button>
              <div
                className={cn(
                  "overflow-hidden transition-all duration-300",
                  openIndex === index ? "max-h-96 pb-5" : "max-h-0"
                )}
              >
                <p className="text-gray-600">{faq.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
