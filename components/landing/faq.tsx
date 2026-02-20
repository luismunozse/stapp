"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion"

const faqs = [
  {
    question: "¿Necesito instalar algo en mi computadora?",
    answer:
      "No, STApp es una aplicación web que funciona directamente en tu navegador desde cualquier dispositivo. Solo necesitas conexión a internet. Además, podés descargar la app nativa para Android (APK), instalarla como PWA en cualquier dispositivo, y próximamente estará disponible también en iOS.",
  },
  {
    question: "¿Puedo probar antes de pagar?",
    answer:
      "¡Por supuesto! Tienes 30 días gratis con acceso completo a todas las funciones, sin necesidad de tarjeta de crédito. Si no te convence, simplemente no hacés nada y la prueba finaliza sin ningún cargo.",
  },
  {
    question: "¿Qué métodos de pago aceptan?",
    answer:
      "Aceptamos tarjetas de crédito, débito, efectivo y otros medios de pago a través de MercadoPago. Podés elegir entre plan mensual o anual (con descuento). Los pagos se procesan de forma segura.",
  },
  {
    question: "¿Puedo cancelar mi suscripción en cualquier momento?",
    answer:
      "Sí, podés cancelar cuando quieras sin penalidades ni cargos ocultos. Mantendrás el acceso a todas las funciones hasta el final del período ya facturado.",
  },
  {
    question: "¿Puedo importar y exportar mis datos?",
    answer:
      "Sí, podés importar clientes e inventario desde archivos Excel o CSV con plantillas descargables y validación automática. También podés exportar tus datos en cualquier momento. Tus datos son tuyos siempre.",
  },
  {
    question: "¿Mis datos están seguros?",
    answer:
      "Absolutamente. Usamos encriptación HTTPS/TLS, controles de acceso estrictos, monitoreo continuo y copias de seguridad periódicas. Tu información y la de tus clientes está protegida en todo momento.",
  },
  {
    question: "¿Cómo funcionan las notificaciones por WhatsApp?",
    answer:
      "STApp incluye plantillas listas para enviar actualizaciones a tus clientes por WhatsApp: aviso de equipo listo, presupuestos, seguimiento de reparación y más. Todo con un solo clic desde la orden de servicio.",
  },
  {
    question: "¿Puedo gestionar varios técnicos y vendedores?",
    answer:
      "Sí, podés agregar técnicos y vendedores ilimitados. Asigná reparaciones, visualizá la carga de trabajo de cada uno y seguí el rendimiento del equipo con métricas en tiempo real.",
  },
  {
    question: "¿Cómo puedo obtener soporte si tengo un problema?",
    answer:
      "Tenés varias opciones: nuestro asistente virtual Santi disponible dentro de la app, el sistema de tickets de soporte para reportar errores o hacer consultas, y también podés contactarnos directamente. Brindamos soporte prioritario a todos los usuarios.",
  },
  {
    question: "¿Pueden agregar funciones que necesito?",
    answer:
      "¡Claro! Estamos en constante mejora basándonos en el feedback de nuestros usuarios. Podés enviar sugerencias desde el sistema de soporte dentro de la app y muchas funciones nuevas nacen de las ideas de nuestros clientes.",
  },
]

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <LazyMotion features={domAnimation}>
      <section id="faq" className="py-6 sm:py-8 overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <m.div
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
          </m.div>

          {/* FAQ list */}
          <div className="max-w-3xl mx-auto">
            {faqs.map((faq, index) => (
              <m.div
                key={faq.question}
                className="border-b"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
              >
                <m.button
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
                  <m.div
                    animate={{ rotate: openIndex === index ? 180 : 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                  >
                    <ChevronDown
                      className="w-5 h-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </m.div>
                </m.button>

                <AnimatePresence initial={false}>
                  {openIndex === index && (
                    <m.div
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
                    </m.div>
                  )}
                </AnimatePresence>
              </m.div>
            ))}
          </div>
        </div>
      </section>
    </LazyMotion>
  )
}
