import { test, expect } from "@playwright/test"

test.describe("Paginas publicas", () => {
  test("landing page carga correctamente", async ({ page }) => {
    await page.goto("/")
    // Verificamos el núcleo del producto en el <title>, estable ante cambios
    // de copy de marca.
    await expect(page).toHaveTitle(/servicio técnico/i)
  })

  test("pagina de registro es accesible", async ({ page }) => {
    await page.goto("/registro")

    // Verificar que existe el formulario de registro
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/nombre/i).first()).toBeVisible()
  })

  test("pagina de recuperar contrasena es accesible", async ({ page }) => {
    await page.goto("/forgot-password")

    await expect(page.getByLabel(/email/i)).toBeVisible()
  })

  test("rutas protegidas redirigen a login", async ({ page }) => {
    await page.goto("/dashboard")

    // Debe redirigir a login
    await expect(page).toHaveURL(/login/)
  })

  test("el hero muestra la promesa y los dos CTAs arriba del fold", async ({ page }) => {
    await page.goto("/")

    // Scope al hero: es la primera <section>. Sin scope, "Probar gratis" matchea
    // también el CTA del navbar y el test dejaría de validar el hero real.
    const hero = page.locator("section").first()

    await expect(
      hero.getByRole("heading", { name: /menos caos en tu taller/i })
    ).toBeVisible()
    // CTA primario (hero) y secundario (demo por WhatsApp)
    await expect(
      hero.getByRole("link", { name: /probar gratis/i })
    ).toBeVisible()
    await expect(
      hero.getByRole("link", { name: /agendar una demo/i })
    ).toBeVisible()
  })

  test("la landing muestra transformación y precios", async ({ page }) => {
    await page.goto("/")

    await expect(
      page.getByRole("heading", { name: /del cuaderno al control total/i })
    ).toBeVisible()
    await expect(
      page.locator("#pricing").getByRole("heading", {
        name: /cuesta menos que una reparación al mes/i,
      })
    ).toBeVisible()
  })

  test("la landing cierra con la banda CTA final después de los precios", async ({ page }) => {
    await page.goto("/")

    const ctaHeading = page.getByRole("heading", {
      name: /mañana tu taller puede trabajar ordenado/i,
    })
    const pricingHeading = page.getByRole("heading", {
      name: /cuesta menos que una reparación al mes/i,
    })

    await expect(ctaHeading).toBeVisible()
    await expect(pricingHeading).toBeVisible()

    const ctaBox = await ctaHeading.boundingBox()
    const pricingBox = await pricingHeading.boundingBox()
    expect(ctaBox && pricingBox).toBeTruthy()
    // La banda CTA es el cierre: va después del pricing.
    expect((ctaBox as { y: number }).y).toBeGreaterThan((pricingBox as { y: number }).y)
  })
})
