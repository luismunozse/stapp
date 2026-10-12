import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Opens the public tracking page the customer sees, in a new tab. */
export function VerLoQueVeTuCliente({ publicToken, className }: { publicToken: string; className?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={cn("shrink-0", className)}>
      <a href={`/seguimiento/${publicToken}`} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Ver lo que ve tu cliente
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    </Button>
  )
}
