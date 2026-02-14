"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

const faqs = [
  {
    question: "¿Necesito instalar algo en mi computadora?",
    answer:
      "No, STApp es una aplicación web que funciona en tu navegador. Solo necesitas conexión a internet. También puedes instalarlo como app en tu celular (PWA).",
  },
  {
    question: "¿Puedo probar antes de pagar?",
    answer:
      "¡Claro! Tienes 30 días gratis para probar todas las funciones sin necesidad de tarjeta de crédito. Si no te convence, puedes cancelar antes de que termine el período de prueba sin ningún cargo.",
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
    question: "¿Puedo importar mis datos de otro sistema?",
    answer:
      "Sí, puedes importar clientes e inventario desde archivos Excel o CSV. El sistema incluye plantillas descargables y validación automática para facilitar el proceso.",
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
    <section id="faq" className="py-6 sm:py-8 overflow-hidden">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          className="text-center max-w-3xl mx-auto mb-6"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Preguntas frecuentes
          </h2>
          <p className="text-lg text-muted-foreground">
            ¿Tienes dudas? Aquí encontrarás las respuestas a las preguntas más
            comunes.
          </p>
        </motion.div>

        {/* FAQ list */}
        <div className="max-w-3xl mx-auto">
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              className="border-b"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <motion.button
                type="button"
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="flex items-center justify-between w-full py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm group"
                aria-expanded={openIndex === index}
                aria-controls={`faq-answer-${index}`}
                id={`faq-question-${index}`}
                whileHover={{ x: 5 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
              >
                <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                  {faq.question}
                </span>
                <motion.div
                  animate={{ rotate: openIndex === index ? 180 : 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <ChevronDown
                    className="w-5 h-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </motion.div>
              </motion.button>

              <AnimatePresence initial={false}>
                {openIndex === index && (
                  <motion.div
                    id={`faq-answer-${index}`}
                    role="region"
                    aria-labelledby={`faq-question-${index}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      height: { duration: 0.3, ease: [0.25, 0.4, 0.25, 1] },
                      opacity: { duration: 0.2 }
                    }}
                    className="overflow-hidden"
                  >
                    <p className="text-muted-foreground pb-5">
                      {faq.answer}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
