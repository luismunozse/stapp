import { test, expect } from "@playwright/test"

test.describe("Paginas publicas", () => {
  test("landing page carga correctamente", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveTitle(/stapp/i)
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
})
