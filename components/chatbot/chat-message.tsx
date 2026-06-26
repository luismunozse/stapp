"use client"

import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"

interface Message {
  id: string
  tipo: "USER" | "ASSISTANT" | "SYSTEM"
  contenido: string
  timestamp: Date
}

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { timezone } = useCurrency()
  const isUser = message.tipo === "USER"
  const isSystem = message.tipo === "SYSTEM"

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-muted px-4 py-2 rounded-full text-xs text-muted-foreground">
          {message.contenido}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex gap-3 mb-4", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm flex-shrink-0">
          S
        </div>
      )}

      {/* Message bubble */}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.contenido}</p>
        <span
          className={cn(
            "text-xs mt-1 block",
            isUser ? "text-primary-foreground/70 text-right" : "text-muted-foreground"
          )}
        >
          {message.timestamp.toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: timezone,
          })}
        </span>
      </div>
    </div>
  )
}
