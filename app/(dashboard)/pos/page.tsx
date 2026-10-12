"use client"

import { PosTerminal } from "@/components/pos/pos-terminal"
import { PosAccessGate } from "@/components/pos/pos-access-gate"

export default function PosPage() {
  return (
    <PosAccessGate>
      <PosTerminal />
    </PosAccessGate>
  )
}
