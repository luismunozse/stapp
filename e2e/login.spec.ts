import { test, expect } from "@playwright/test"

test.describe("Login", () => {
  test("muestra formulario de login", async ({ page }) => {
    await page.goto("/login")

    // Verificar que el formulario existe
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/contrase/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /iniciar sesion|ingresar/i })).toBeVisible()
  })

  test("muestra error con credenciales invalidas", async ({ page }) => {
    await page.goto("/login")

    await page.getByLabel(/email/i).fill("usuario-inexistente@test.com")
    await page.getByLabel(/contrase/i).fill("password-incorrecto")
    await page.getByRole("button", { name: /iniciar sesion|ingresar/i }).click()

    // Esperar mensaje de error
    await expect(page.getByText(/incorrecto|invalido|error|no autorizado/i)).toBeVisible({
      timeout: 10000,
    })
  })

  test("tiene link para recuperar contrasena", async ({ page }) => {
    await page.goto("/login")

    const forgotLink = page.getByRole("link", { name: /olvidaste|recuperar|forgot/i })
    await expect(forgotLink).toBeVisible()
  })

  test("tiene link para registrarse", async ({ page }) => {
    await page.goto("/login")

    const registerLink = page.getByRole("link", { name: /registr|crear cuenta|sign up/i })
    await expect(registerLink).toBeVisible()
  })
})
