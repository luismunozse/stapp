import { TecnicosList } from "@/components/tecnicos/tecnicos-list"

export default function TecnicosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Técnicos</h1>
        <p className="text-muted-foreground">
          Gestiona los técnicos y sus asignaciones
        </p>
      </div>
      <TecnicosList />
    </div>
  )
}

