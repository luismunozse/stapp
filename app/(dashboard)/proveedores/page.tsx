import { ProveedoresList } from "@/components/proveedores/proveedores-list"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export default function ProveedoresPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Proveedores</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los proveedores mayoristas y actualiza los precios
          </p>
        </div>
        <Link href="/proveedores/comparar">
          <Button variant="outline">
            Comparar Precios
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <ProveedoresList />
    </div>
  )
}
