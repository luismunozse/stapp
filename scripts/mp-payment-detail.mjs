// Diagnóstico de pagos rechazados de MercadoPago.
// Uso: node scripts/mp-payment-detail.mjs <paymentId> [paymentId...]
// Lee MERCADOPAGO_ACCESS_TOKEN de .env.vercel.
import fs from "node:fs"

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error("Uso: node scripts/mp-payment-detail.mjs <paymentId> [paymentId...]")
  process.exit(1)
}

const ENV_FILE = ".env.vercel"
const line = fs.existsSync(ENV_FILE)
  ? fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/).find((l) => l.startsWith("MERCADOPAGO_ACCESS_TOKEN="))
  : null
if (!line) {
  console.error("MERCADOPAGO_ACCESS_TOKEN no está en .env.vercel")
  process.exit(1)
}
const token = line.slice("MERCADOPAGO_ACCESS_TOKEN=".length).trim().replace(/^['"]|['"]$/g, "").trim()

for (const id of ids) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.log(`\n=== ${id} === ERROR ${res.status}: ${(await res.text()).slice(0, 300)}`)
    continue
  }
  const p = await res.json()
  const out = {
    id: p.id,
    status: p.status,
    status_detail: p.status_detail,            // ← el "por qué" del rechazo
    payment_type: p.payment_type_id,            // credit_card / debit_card / account_money...
    payment_method: p.payment_method_id,        // visa / master / amex...
    amount: p.transaction_amount,
    currency: p.currency_id,
    card_bin: p.card?.first_six_digits ?? null, // BIN → país/emisor de la tarjeta
    card_last4: p.card?.last_four_digits ?? null,
    cardholder: p.card?.cardholder?.name ?? null,
    issuer_id: p.issuer_id ?? null,
    payer_email: p.payer?.email ?? null,
    payer_id_type: p.payer?.identification?.type ?? null,
    payer_country: p.payer?.address?.country ?? p.additional_info?.payer?.address?.country ?? null,
    date_created: p.date_created,
    money_release_status: p.money_release_status ?? null,
  }
  console.log(`\n=== ${id} ===`)
  console.log(JSON.stringify(out, null, 2))
}
