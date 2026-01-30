import { AlertCircle } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "./alert"

interface ErrorStateProps {
  title?: string
  message: string
  retry?: () => void
  className?: string
}

export function ErrorState({
  title = "Error al cargar datos",
  message,
  retry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4", className)}>
      <Alert variant="destructive" className="max-w-md">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="mt-2">
          {message}
        </AlertDescription>
        {retry && (
          <Button
            onClick={retry}
            variant="outline"
            size="sm"
            className="mt-4"
          >
            Reintentar
          </Button>
        )}
      </Alert>
    </div>
  )
}
