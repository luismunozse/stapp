import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export async function GET() {
  const swPath = path.join(process.cwd(), "public", "sw.js")
  
  try {
    const swContent = fs.readFileSync(swPath, "utf-8")
    return new NextResponse(swContent, {
      headers: {
        "Content-Type": "application/javascript",
      },
    })
  } catch (error) {
    return new NextResponse("Service Worker not found", { status: 404 })
  }
}

