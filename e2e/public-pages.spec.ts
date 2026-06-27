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

  test("la landing muestra eyebrows de seccion", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Plataforma todo-en-uno", { exact: true })).toBeVisible()
    await expect(page.getByText("Precios", { exact: true })).toBeVisible()
  })

  test("la landing tiene banda CTA antes de los precios", async ({ page }) => {
    await page.goto("/")

    const ctaHeading = page.getByRole("heading", {
      name: /empezá a ordenar tu taller hoy/i,
    })
    const pricingHeading = page.getByRole("heading", {
      name: /elegí el plan que mejor se adapte/i,
    })

    await expect(ctaHeading).toBeVisible()
    await expect(pricingHeading).toBeVisible()

    const ctaBox = await ctaHeading.boundingBox()
    const pricingBox = await pricingHeading.boundingBox()
    expect(ctaBox && pricingBox).toBeTruthy()
    // CTA band sits above the pricing section.
    expect((ctaBox as { y: number }).y).toBeLessThan((pricingBox as { y: number }).y)
  })
})
