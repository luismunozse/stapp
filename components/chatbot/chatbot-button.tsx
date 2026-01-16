"use client"

import { useState } from "react"
import { Bot } from "lucide-react"
import { ChatbotPanel } from "./chatbot-panel"
import { cn } from "@/lib/utils"

export function ChatbotButton() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Panel del chatbot */}
      <ChatbotPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />

      {/* Botón flotante con robot animado */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-50",
            "w-16 h-16 rounded-full",
            "bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500",
            "hover:from-blue-600 hover:via-purple-600 hover:to-pink-600",
            "text-white",
            "shadow-lg hover:shadow-2xl",
            "transition-all duration-300",
            "flex items-center justify-center",
            "group",
            "focus:outline-none focus:ring-4 focus:ring-purple-400 focus:ring-offset-2",
            "animate-bounce-slow"
          )}
          aria-label="Abrir chat con Santi"
          style={{
            animation: "bounce-slow 3s ease-in-out infinite, pulse-glow 2s ease-in-out infinite",
          }}
        >
          {/* Robot icon con animación de wave */}
          <Bot className="w-8 h-8 group-hover:scale-125 transition-transform duration-300 animate-wave" />

          {/* Badge de "online" con pulso */}
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500 border-2 border-white"></span>
          </span>

          {/* Tooltip al hacer hover */}
          <span className="absolute bottom-full mb-2 px-3 py-1 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap pointer-events-none">
            Hola! Soy Santi 👋
          </span>
        </button>
      )}

      {/* Estilos de animación personalizados */}
      <style jsx>{`
        @keyframes bounce-slow {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }

        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.5), 0 0 40px rgba(139, 92, 246, 0.3);
          }
          50% {
            box-shadow: 0 0 30px rgba(139, 92, 246, 0.7), 0 0 60px rgba(139, 92, 246, 0.5);
          }
        }

        @keyframes wave {
          0%, 100% {
            transform: rotate(0deg);
          }
          25% {
            transform: rotate(-15deg);
          }
          75% {
            transform: rotate(15deg);
          }
        }

        .animate-wave {
          animation: wave 1s ease-in-out infinite;
        }
      `}</style>
    </>
  )
}
