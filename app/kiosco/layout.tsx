export default function KioskLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="dark">
      <body className="bg-gray-950">{children}</body>
    </html>
  )
}
