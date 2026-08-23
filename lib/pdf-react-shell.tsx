// Layout pieces shared by the A4 documents rendered with @react-pdf/renderer.
//
// The split against lib/pdf-react-shared.ts is deliberate: that file holds
// primitives with NO geometry (tokens, safe, fetchLogo, Helvetica metrics,
// truncateToWidth). Anything that draws or positions lives here.
//
// Out of scope by design: the thermal ticket (58/80mm) and ESC/POS. They are
// a different medium — 32 characters wide, no fonts, no layout.
import * as React from "react"
import { View, Text, StyleSheet } from "@react-pdf/renderer"
import { MONO, TYPE, RULE_WIDTH } from "./pdf-react-shared"

/** The one wording. Previously written three different ways across engines. */
export const LEYENDA_NO_FISCAL = "Documento no válido como comprobante fiscal"

/** Footer variant: names the document, then the legend. */
export const leyendaPie = (documento: string) =>
  `${documento} — no válido como comprobante fiscal.`

// Named `estilosShell` and exported from the start: Tasks 4-7 add to this same
// object, and documents compose their own rows against it.
export const estilosShell = StyleSheet.create({
  footer: { position: "absolute", bottom: 40, left: 40, right: 40 },
  footerRule: { borderBottomWidth: RULE_WIDTH, borderBottomColor: MONO.rule },
  footerDisclaimer: { fontSize: TYPE.fine, color: MONO.faint, marginTop: 8 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  footerFine: { fontSize: 7, color: MONO.faint },
  footerPageNum: { fontSize: TYPE.small, color: MONO.faint },
})

export function Pie({ leyenda, fechaImpresion }: { leyenda: string; fechaImpresion: string }) {
  return (
    <View style={estilosShell.footer} fixed>
      <View style={estilosShell.footerRule} />
      <Text style={estilosShell.footerDisclaimer}>{leyenda}</Text>
      <View style={estilosShell.footerRow}>
        <Text style={estilosShell.footerFine}>Impreso: {fechaImpresion}</Text>
        <Text
          style={estilosShell.footerPageNum}
          render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Página ${pageNumber} de ${totalPages}` : "")}
        />
      </View>
    </View>
  )
}
