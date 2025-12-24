import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  // Crear usuarios de ejemplo
  const adminPassword = await bcrypt.hash("admin123", 10)
  const tecnicoPassword = await bcrypt.hash("tecnico123", 10)

    const admin = await prisma.user.upsert({
      where: { email: "admin@serviciotecnico.com" },
      update: {},
      create: {
        email: "admin@serviciotecnico.com",
        password: adminPassword,
        nombre: "Administrador",
        rol: "ADMIN", // String en lugar de enum
      },
    })

    const tecnico = await prisma.user.upsert({
      where: { email: "tecnico@serviciotecnico.com" },
      update: {},
      create: {
        email: "tecnico@serviciotecnico.com",
        password: tecnicoPassword,
        nombre: "Juan Pérez",
        rol: "TECNICO", // String en lugar de enum
      },
    })

  // Crear cliente de ejemplo
  const cliente = await prisma.cliente.upsert({
    where: { id: "cliente-ejemplo" },
    update: {},
    create: {
      id: "cliente-ejemplo",
      nombre: "María González",
      telefono: "+5491112345678",
      email: "maria@example.com",
      direccion: "Av. Corrientes 1234, CABA",
      dni: "12345678",
    },
  })

  // Crear inventario de ejemplo
  const inventario1 = await prisma.inventario.create({
    data: {
      codigo: "BAT-001",
      nombre: "Batería iPhone 12",
      descripcion: "Batería de repuesto para iPhone 12",
      categoria: "Baterías",
      tipoDispositivo: "CELULAR", // String en lugar de enum
      stock: 10,
      precioCompra: 15000,
      precioVenta: 25000,
      proveedor: "Distribuidor Tech",
    },
  })

  const inventario2 = await prisma.inventario.create({
    data: {
      codigo: "PANT-001",
      nombre: "Pantalla Samsung Galaxy S21",
      descripcion: "Pantalla completa para Samsung Galaxy S21",
      categoria: "Pantallas",
      tipoDispositivo: "CELULAR", // String en lugar de enum
      stock: 5,
      precioCompra: 45000,
      precioVenta: 75000,
      proveedor: "Distribuidor Tech",
    },
  })

  const inventario3 = await prisma.inventario.create({
    data: {
      codigo: "RAM-001",
      nombre: "Memoria RAM DDR4 8GB",
      descripcion: "Memoria RAM DDR4 8GB para PC",
      categoria: "Memoria",
      tipoDispositivo: "COMPUTADORA", // String en lugar de enum
      stock: 20,
      precioCompra: 20000,
      precioVenta: 35000,
      proveedor: "Distribuidor Tech",
    },
  })

  console.log("Seed completado:")
  console.log({ admin, tecnico, cliente, inventario1, inventario2, inventario3 })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

