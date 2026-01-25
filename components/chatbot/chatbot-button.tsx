"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Bot, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

// Lazy load del panel - solo se carga cuando el usuario abre el chat
const ChatbotPanel = dynamic(() => import("./chatbot-panel").then(mod => mod.ChatbotPanel), {
  ssr: false,
  loading: () => (
    <div className="fixed bottom-6 right-6 z-50 w-[90vw] max-w-md h-[600px] max-h-[80vh] bg-card border shadow-2xl rounded-2xl flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  ),
})

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
            "animate-bounce-slow animate-pulse-glow"
          )}
          aria-label="Abrir chat con Santi"
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
    </>
  )
}
