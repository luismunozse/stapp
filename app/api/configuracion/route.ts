import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { uploadLogo, deleteLogo, dataUrlToBuffer } from "@/lib/storage"
import { COUNTRIES, getIvaGeneral } from "@/lib/countries"
import { resolveTerminologia, sanitizeTerminologia } from "@/lib/terminologia"
import { isMissingColumnError } from "@/lib/db-errors"
import { hasPlanFeature } from "@/lib/subscriptions"

// GET - Obtener configuraciÃ³n (solo ADMIN)
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Intentar con todas las columnas, fallback sin recepcion_terminos si no existe
    let organization: any = null
    let dbError: any = null

    const baseSelect = `
        id,
        logo_url,
        logo_path,
        nombre_mostrar,
        nombre,
        email,
        telefono,
        direccion,
        ciudad,
        provincia,
        codigo_postal,
        moneda,
        zona_horaria,
        umbral_stock_bajo,
        iva_porcentaje,
        cotizacion_validez_dias,
        cotizacion_terminos,
        recepcion_terminos,
        comprobante_terminos,
        garantia_dias_default,
        politica_abandono_dias_default,
        anticipo_porcentaje_default,
        pais,
        modulo_agenda,
        vendedores_administran_inventario,
        tecnicos_operan_pos,
        iva_regimen,
        iva_tasa,
        redondeo_efectivo,
        comision_aplica_sin_reparacion,
        terminologia
      `
    // Datos fiscales y de cobro (migración 295). Seleccionados aparte del
    // resto de columnas: si esa migración todavía no corrió en este entorno,
    // el PGRST204 de estas 6 columnas no debe tumbar el resto de la config
    // (ver reintento sin ellas más abajo).
    const fiscalSelect = `${baseSelect}, cuit, condicion_iva, domicilio_fiscal, cbu_alias, medios_pago_texto, plazo_pago_dias`
    // Toggle de facturación electrónica (migración 296). Las migraciones se
    // aplican a mano, una por una, en orden — 295 puede estar aplicada sin
    // que 296 lo esté todavía (ventana real mientras se despliega esta
    // feature), así que degrada de forma INDEPENDIENTE: perder 296 no debe
    // tumbar los 6 campos fiscales de 295 que sí existen.
    const facturacionSelect = `${fiscalSelect}, facturacion_electronica_habilitada`
    // Datos del remito formato clásico (migración 297): ingresos brutos +
    // inicio de actividades del emisor. Igual que el resto, se piden aparte
    // para poder degradar de forma independiente si 297 todavía no corrió
    // (puede pasar sin que 296 lo esté, ya que las migraciones se aplican a
    // mano en orden — ver reintento sin ellas más abajo).
    const settingsSelect = `${facturacionSelect}, ingresos_brutos, inicio_actividades`

    let result = await supabaseAdmin
      .from("organizations")
      .select(settingsSelect)
      .eq("id", organizationId!)
      .single()

    if (isMissingColumnError(result.error)) {
      // Migración 297 no aplicada todavía: reintentar sin ingresos_brutos /
      // inicio_actividades, conservando las columnas de 295 y 296. SELECT
      // pura (sin .update()): 42703, no PGRST204.
      result = await supabaseAdmin
        .from("organizations")
        .select(facturacionSelect)
        .eq("id", organizationId!)
        .single()
    }

    if (isMissingColumnError(result.error)) {
      // Migración 296 no aplicada todavía: reintentar sin el toggle de
      // facturación electrónica, conservando las columnas de 295. SELECT
      // pura (sin .update()): Postgres devuelve 42703 ("column ... does not
      // exist"), no PGRST204 — PGRST204 solo aparece cuando el payload de
      // una escritura nombra una columna desconocida. isMissingColumnError()
      // cubre ambos casos.
      result = await supabaseAdmin
        .from("organizations")
        .select(fiscalSelect)
        .eq("id", organizationId!)
        .single()
    }

    if (isMissingColumnError(result.error)) {
      // Migración 295 tampoco aplicada: reintentar sin las columnas fiscales.
      result = await supabaseAdmin
        .from("organizations")
        .select(baseSelect)
        .eq("id", organizationId!)
        .single()
    }

    if (isMissingColumnError(result.error)) {
      // Column doesn't exist yet, query without it
      const fallback = await supabaseAdmin
        .from("organizations")
        .select(`
          id, logo_url, logo_path, nombre_mostrar, nombre, email,
          telefono, direccion, moneda, zona_horaria, umbral_stock_bajo,
          iva_porcentaje, cotizacion_validez_dias, cotizacion_terminos, pais
        `)
        .eq("id", organizationId!)
        .single()
      organization = fallback.data
      dbError = fallback.error
    } else {
      organization = result.data
      dbError = result.error
    }

    if (dbError || !organization) {
      return NextResponse.json({ error: "OrganizaciÃ³n no encontrada" }, { status: 404 })
    }

    const facturacionElectronicaDisponible =
      organization.pais === "AR" && (await hasPlanFeature(organizationId!, "facturacion_electronica"))

    // Mapear para compatibilidad con frontend
    return NextResponse.json({
      id: organization.id,
      logoUrl: organization.logo_url,
      logoData: null, // Ya no usamos base64
      logoMime: null,
      nombreEmpresa: organization.nombre_mostrar,
      nombre: organization.nombre,
      email: organization.email,
      telefono: organization.telefono,
      direccion: organization.direccion,
      ciudad: organization.ciudad || "",
      provincia: organization.provincia || "",
      codigoPostal: organization.codigo_postal || "",
      moneda: organization.moneda || "ARS",
      zonaHoraria: organization.zona_horaria || "America/Argentina/Buenos_Aires",
      umbralStockBajo: organization.umbral_stock_bajo ?? 5,
      ivaPorcentaje: organization.iva_porcentaje ?? 0,
      cotizacionValidezDias: organization.cotizacion_validez_dias ?? 30,
      cotizacionTerminos: organization.cotizacion_terminos || "",
      recepcionTerminos: organization.recepcion_terminos || "",
      comprobanteTerminos: organization.comprobante_terminos || "",
      garantiaDiasDefault: organization.garantia_dias_default ?? 30,
      politicaAbandonoDiasDefault: organization.politica_abandono_dias_default ?? 60,
      anticipoPorcentajeDefault: organization.anticipo_porcentaje_default ?? 50,
      pais: organization.pais || "AR",
      moduloAgenda: !!organization.modulo_agenda,
      vendedoresAdministranInventario: !!organization.vendedores_administran_inventario,
      tecnicosOperanPos: !!organization.tecnicos_operan_pos,
      ivaRegimen: organization.iva_regimen ?? "EXENTO",
      ivaTasa: organization.iva_tasa ?? getIvaGeneral(organization.pais),
      redondeoEfectivo: organization.redondeo_efectivo ?? 0,
      comisionAplicaSinReparacion: organization.comision_aplica_sin_reparacion ?? false,
      terminologia: resolveTerminologia(organization.terminologia),
      terminologiaOverrides: organization.terminologia ?? {},
      cuit: organization.cuit || "",
      condicionIva: organization.condicion_iva || "",
      domicilioFiscal: organization.domicilio_fiscal || "",
      ingresosBrutos: organization.ingresos_brutos || "",
      inicioActividades: organization.inicio_actividades || "",
      cbuAlias: organization.cbu_alias || "",
      mediosPagoTexto: organization.medios_pago_texto || "",
      plazoPagoDias: organization.plazo_pago_dias ?? null,
      facturacionElectronicaHabilitada: !!organization.facturacion_electronica_habilitada,
      facturacionElectronicaDisponible,
    })
  } catch (error) {
    console.error("Error fetching config:", error)
    return NextResponse.json({ error: "Error al obtener configuraciÃ³n" }, { status: 500 })
  }
}

// PUT - Actualizar configuraciÃ³n (solo ADMIN)
export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch (parseError) {
      console.error("Error parsing request body:", parseError)
      return NextResponse.json(
        { error: "El archivo es demasiado grande. Usa una imagen de menor tamaÃ±o (mÃ¡x 1MB)." },
        { status: 413 }
      )
    }
    const { logoData, logoMime, nombreEmpresa, telefono, direccion, ciudad, provincia, codigoPostal, moneda, zonaHoraria, umbralStockBajo, ivaPorcentaje, cotizacionValidezDias, cotizacionTerminos, recepcionTerminos, comprobanteTerminos, garantiaDiasDefault, politicaAbandonoDiasDefault, anticipoPorcentajeDefault, pais, moduloAgenda, vendedoresAdministranInventario, tecnicosOperanPos, ivaRegimen, ivaTasa, redondeoEfectivo, comisionAplicaSinReparacion, terminologia, cuit, condicionIva, domicilioFiscal, cbuAlias, mediosPagoTexto, plazoPagoDias, facturacionElectronicaHabilitada, ingresosBrutos, inicioActividades } = body

    const updateData: Record<string, any> = {}

    // Actualizar telefono y direccion si se proporcionan
    if (telefono !== undefined) {
      updateData.telefono = telefono || null
    }
    if (direccion !== undefined) {
      updateData.direccion = direccion || null
    }
    if (ciudad !== undefined) {
      updateData.ciudad = ciudad || null
    }
    if (provincia !== undefined) {
      updateData.provincia = provincia || null
    }
    if (codigoPostal !== undefined) {
      updateData.codigo_postal = codigoPostal || null
    }

    // Si hay nuevo logo en base64, subirlo a Storage
    if (logoData && logoMime) {
      // Validar tamaÃ±o
      const base64Size = logoData.length * 0.75
      if (base64Size > 2 * 1024 * 1024) {
        return NextResponse.json(
          { error: "La imagen es demasiado grande (mÃ¡x 2MB)" },
          { status: 400 }
        )
      }

      try {
        // Construir data URL si no viene completo
        const dataUrl = logoData.startsWith("data:")
          ? logoData
          : `data:${logoMime};base64,${logoData}`

        const { buffer, mime } = dataUrlToBuffer(dataUrl)
        const { url, path } = await uploadLogo(organizationId!, buffer, mime)

        updateData.logo_url = url
        updateData.logo_path = path
      } catch (uploadError) {
        console.error("Error uploading logo:", uploadError)
        return NextResponse.json(
          { error: "Error al subir logo" },
          { status: 500 }
        )
      }
    }

    if (nombreEmpresa !== undefined) {
      updateData.nombre_mostrar = nombreEmpresa
    }

    if (moneda !== undefined) {
      const validCurrencies = ["ARS","USD","MXN","CLP","COP","PEN","UYU","BRL","BOB","PYG","EUR"]
      if (validCurrencies.includes(moneda)) {
        updateData.moneda = moneda
      }
    }

    if (zonaHoraria !== undefined && typeof zonaHoraria === "string") {
      // Validate timezone by trying to use it
      try {
        Intl.DateTimeFormat(undefined, { timeZone: zonaHoraria })
        updateData.zona_horaria = zonaHoraria
      } catch {
        // Invalid timezone, ignore
      }
    }

    if (umbralStockBajo !== undefined) {
      const val = parseInt(umbralStockBajo)
      if (!isNaN(val) && val >= 0) {
        updateData.umbral_stock_bajo = val
      }
    }

    if (ivaPorcentaje !== undefined) {
      const val = parseFloat(ivaPorcentaje)
      if (!isNaN(val) && val >= 0 && val <= 100) {
        updateData.iva_porcentaje = val
      }
    }

    if (cotizacionValidezDias !== undefined) {
      const val = parseInt(cotizacionValidezDias)
      if (!isNaN(val) && val >= 1) {
        updateData.cotizacion_validez_dias = val
      }
    }

    if (cotizacionTerminos !== undefined) {
      updateData.cotizacion_terminos = cotizacionTerminos || null
    }

    // recepcion_terminos puede no existir si la migraciÃ³n 072 no se ejecutÃ³
    let hasRecepcionTerminos = true
    if (recepcionTerminos !== undefined) {
      updateData.recepcion_terminos = recepcionTerminos || null
    }

    if (comprobanteTerminos !== undefined) {
      updateData.comprobante_terminos = comprobanteTerminos || null
    }

    if (garantiaDiasDefault !== undefined) {
      const val = parseInt(garantiaDiasDefault)
      if (!isNaN(val) && val >= 0) {
        updateData.garantia_dias_default = val
      }
    }

    if (politicaAbandonoDiasDefault !== undefined) {
      const val = parseInt(politicaAbandonoDiasDefault)
      if (!isNaN(val) && val >= 0) {
        updateData.politica_abandono_dias_default = val
      }
    }

    if (anticipoPorcentajeDefault !== undefined) {
      const val = parseFloat(anticipoPorcentajeDefault)
      if (!isNaN(val) && val >= 0 && val <= 100) {
        updateData.anticipo_porcentaje_default = val
      }
    }

    if (pais !== undefined && typeof pais === "string" && pais in COUNTRIES) {
      updateData.pais = pais
    }

    if (moduloAgenda !== undefined) {
      updateData.modulo_agenda = !!moduloAgenda
    }

    if (vendedoresAdministranInventario !== undefined) {
      updateData.vendedores_administran_inventario = !!vendedoresAdministranInventario
    }

    if (tecnicosOperanPos !== undefined) {
      updateData.tecnicos_operan_pos = !!tecnicosOperanPos
    }

    if (ivaRegimen !== undefined) {
      const validRegimen = ["EXENTO", "INCLUIDO", "ADITIVO"]
      if (validRegimen.includes(ivaRegimen)) {
        updateData.iva_regimen = ivaRegimen
      }
    }

    if (ivaTasa !== undefined) {
      const val = parseFloat(ivaTasa)
      if (!isNaN(val) && val >= 0 && val <= 100) {
        updateData.iva_tasa = val
      }
    }

    if (redondeoEfectivo !== undefined) {
      const val = parseInt(redondeoEfectivo)
      if (!isNaN(val) && val >= 0) {
        updateData.redondeo_efectivo = val
      }
    }

    if (comisionAplicaSinReparacion !== undefined) {
      updateData.comision_aplica_sin_reparacion = !!comisionAplicaSinReparacion
    }

    if (terminologia !== undefined && terminologia !== null && typeof terminologia === "object") {
      updateData.terminologia = sanitizeTerminologia(terminologia as Record<string, unknown>)
    }

    // Datos fiscales y de cobro (migración 295) — alimentan el remito.
    if (cuit !== undefined) {
      updateData.cuit = cuit || null
    }

    if (condicionIva !== undefined) {
      const validCondicionIva = ["Responsable Inscripto", "Monotributo", "Exento", "Consumidor Final"]
      if (condicionIva === "" || validCondicionIva.includes(condicionIva)) {
        updateData.condicion_iva = condicionIva || null
      }
    }

    if (domicilioFiscal !== undefined) {
      updateData.domicilio_fiscal = domicilioFiscal || null
    }

    // Ingresos brutos + inicio de actividades del emisor (migración 297) —
    // texto libre, se muestran en el encabezado del remito formato clásico.
    if (ingresosBrutos !== undefined) {
      updateData.ingresos_brutos = ingresosBrutos || null
    }

    if (inicioActividades !== undefined) {
      updateData.inicio_actividades = inicioActividades || null
    }

    if (cbuAlias !== undefined) {
      updateData.cbu_alias = cbuAlias || null
    }

    if (mediosPagoTexto !== undefined) {
      updateData.medios_pago_texto = mediosPagoTexto || null
    }

    if (plazoPagoDias !== undefined) {
      if (plazoPagoDias === "" || plazoPagoDias === null) {
        updateData.plazo_pago_dias = null
      } else {
        const val = parseInt(plazoPagoDias)
        if (!isNaN(val) && val >= 0) {
          updateData.plazo_pago_dias = val
        }
      }
    }

    // Toggle de facturación electrónica (migración 296).
    if (facturacionElectronicaHabilitada !== undefined) {
      updateData.facturacion_electronica_habilitada = !!facturacionElectronicaHabilitada
    }

    const selectCols = "id, logo_url, logo_path, nombre_mostrar, telefono, direccion, ciudad, provincia, codigo_postal, moneda, zona_horaria, umbral_stock_bajo, iva_porcentaje, cotizacion_validez_dias, cotizacion_terminos, garantia_dias_default, politica_abandono_dias_default, anticipo_porcentaje_default, pais, modulo_agenda, vendedores_administran_inventario, tecnicos_operan_pos, iva_regimen, iva_tasa, redondeo_efectivo, comision_aplica_sin_reparacion, terminologia"
    // Pre-295: lo que ya persistÃ­a antes de esta migraciÃ³n. Se usa como
    // segundo intento (ver PGRST204 abajo) para que un 295 sin aplicar
    // solo tumbe los 6 campos fiscales nuevos, no recepcion_terminos/
    // comprobante_terminos ni el resto del update.
    const selectColsPre295 = selectCols + ", recepcion_terminos, comprobante_terminos"
    // Pre-296: campos fiscales (migración 295), sin el toggle de facturación
    // electrónica todavía.
    const selectColsFull = selectColsPre295 + ", cuit, condicion_iva, domicilio_fiscal, cbu_alias, medios_pago_texto, plazo_pago_dias"
    // Full: 295 + toggle de facturación electrónica (migración 296). Las
    // migraciones se aplican a mano, una por una — 295 puede estar aplicada
    // sin que 296 lo esté todavía, así que degrada de forma independiente
    // (ver reintentos abajo) en lugar de tumbar los 6 campos fiscales junto
    // con el toggle.
    const selectColsFull296 = selectColsFull + ", facturacion_electronica_habilitada"
    // "Remito formato clásico" (migración 297): ingresos brutos + inicio de
    // actividades del emisor. Igual que el resto, se piden aparte para poder
    // degradar de forma independiente si 297 todavía no corrió (puede pasar
    // sin que 296 lo esté, ya que las migraciones se aplican a mano en
    // orden — ver reintentos abajo).
    const selectColsFull297 = selectColsFull296 + ", ingresos_brutos, inicio_actividades"

    // Solo actualizar si hay cambios
    if (Object.keys(updateData).length === 0) {
      // Retornar estado actual. Mismo escalonado PGRST204 que el resto del
      // archivo: PostgREST solo devuelve las columnas pedidas, así que usar
      // `selectCols` a secas acá (como antes) devolvía recepcion_terminos/
      // comprobante_terminos/los 6 campos fiscales siempre vacíos aunque
      // estuvieran cargados en la DB.
      let { data, error: selectError } = await supabaseAdmin
        .from("organizations")
        .select(selectColsFull297)
        .eq("id", organizationId!)
        .single()
      if (isMissingColumnError(selectError)) {
        // Migración 297 no aplicada: reintentar sin ingresos_brutos /
        // inicio_actividades, conservando los 6 campos fiscales de 295 y el
        // toggle de 296. SELECT pura (sin .update()): 42703, no PGRST204.
        ;({ data, error: selectError } = await supabaseAdmin
          .from("organizations")
          .select(selectColsFull296)
          .eq("id", organizationId!)
          .single())
      }
      if (isMissingColumnError(selectError)) {
        // Migración 296 no aplicada: reintentar sin el toggle de facturación
        // electrónica, conservando los 6 campos fiscales de 295. SELECT pura
        // (sin .update()): 42703, no PGRST204.
        ;({ data, error: selectError } = await supabaseAdmin
          .from("organizations")
          .select(selectColsFull)
          .eq("id", organizationId!)
          .single())
      }
      if (isMissingColumnError(selectError)) {
        // Migración 295 tampoco aplicada: reintentar sin las columnas
        // fiscales. SELECT pura otra vez (sin .update()): 42703, no PGRST204.
        ;({ data } = await supabaseAdmin
          .from("organizations")
          .select(selectColsPre295)
          .eq("id", organizationId!)
          .single())
      }
      const org = data as any

      return NextResponse.json({
        id: org?.id,
        logoUrl: org?.logo_url,
        nombreEmpresa: org?.nombre_mostrar,
        telefono: org?.telefono,
        direccion: org?.direccion,
        ciudad: org?.ciudad || "",
        provincia: org?.provincia || "",
        codigoPostal: org?.codigo_postal || "",
        moneda: org?.moneda || "ARS",
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
        umbralStockBajo: org?.umbral_stock_bajo ?? 5,
        ivaPorcentaje: org?.iva_porcentaje ?? 0,
        cotizacionValidezDias: org?.cotizacion_validez_dias ?? 30,
        cotizacionTerminos: org?.cotizacion_terminos || "",
        recepcionTerminos: org?.recepcion_terminos || "",
        comprobanteTerminos: org?.comprobante_terminos || "",
        garantiaDiasDefault: org?.garantia_dias_default ?? 30,
        politicaAbandonoDiasDefault: org?.politica_abandono_dias_default ?? 60,
        anticipoPorcentajeDefault: org?.anticipo_porcentaje_default ?? 50,
        pais: org?.pais || "AR",
        moduloAgenda: !!org?.modulo_agenda,
        vendedoresAdministranInventario: !!org?.vendedores_administran_inventario,
        tecnicosOperanPos: !!org?.tecnicos_operan_pos,
        ivaRegimen: org?.iva_regimen ?? "EXENTO",
        ivaTasa: org?.iva_tasa ?? getIvaGeneral(org?.pais),
        redondeoEfectivo: org?.redondeo_efectivo ?? 0,
        comisionAplicaSinReparacion: org?.comision_aplica_sin_reparacion ?? false,
        terminologia: resolveTerminologia(org?.terminologia),
        terminologiaOverrides: org?.terminologia ?? {},
        cuit: org?.cuit || "",
        condicionIva: org?.condicion_iva || "",
        domicilioFiscal: org?.domicilio_fiscal || "",
        ingresosBrutos: org?.ingresos_brutos || "",
        inicioActividades: org?.inicio_actividades || "",
        cbuAlias: org?.cbu_alias || "",
        mediosPagoTexto: org?.medios_pago_texto || "",
        plazoPagoDias: org?.plazo_pago_dias ?? null,
        facturacionElectronicaHabilitada: !!org?.facturacion_electronica_habilitada,
      })
    }

    // Intentar update con todas las columnas
    let result2 = await supabaseAdmin
      .from("organizations")
      .update(updateData)
      .eq("id", organizationId!)
      .select(selectColsFull297)
      .single()

    if (isMissingColumnError(result2.error)) {
      // Migración 297 no aplicada todavía: reintentar sin ingresos_brutos /
      // inicio_actividades en el payload de escritura ni en el select,
      // conservando los 6 campos fiscales de 295 y el toggle de 296 en
      // updateData (297 puede estar ausente sin que 295/296 lo estén).
      delete updateData.ingresos_brutos
      delete updateData.inicio_actividades
      result2 = await supabaseAdmin
        .from("organizations")
        .update(updateData)
        .eq("id", organizationId!)
        .select(selectColsFull296)
        .single() as any
    }

    if (isMissingColumnError(result2.error)) {
      // Migración 296 no aplicada todavía: reintentar sin el toggle de
      // facturación electrónica, conservando los 6 campos fiscales de 295 en
      // updateData (295 puede estar aplicada sin que 296 lo esté). Este
      // primer intento sí suele dar PGRST204 real si el body trae
      // facturacionElectronicaHabilitada (updateData nombra una columna
      // desconocida en el payload de escritura), pero isMissingColumnError
      // también cubre el 42703 que daría un RETURNING con columnas
      // desconocidas si el body no la incluyera.
      delete updateData.facturacion_electronica_habilitada
      result2 = await supabaseAdmin
        .from("organizations")
        .update(updateData)
        .eq("id", organizationId!)
        .select(selectColsFull)
        .single() as any
    }

    if (isMissingColumnError(result2.error)) {
      // Migración 295 tampoco aplicada todavía: reintentar sin los 6 campos
      // fiscales nuevos. El resto de updateData (recepcion_terminos,
      // iva_regimen, terminologia, etc.) sigue intacto: esas columnas SÍ
      // existen hoy, así que deben persistirse igual.
      delete updateData.cuit
      delete updateData.condicion_iva
      delete updateData.domicilio_fiscal
      delete updateData.cbu_alias
      delete updateData.medios_pago_texto
      delete updateData.plazo_pago_dias
      result2 = await supabaseAdmin
        .from("organizations")
        .update(updateData)
        .eq("id", organizationId!)
        .select(selectColsPre295)
        .single() as any
    }

    if (isMissingColumnError(result2.error)) {
      // recepcion_terminos column doesn't exist yet, retry without it
      delete updateData.recepcion_terminos
      hasRecepcionTerminos = false
      // Also strip fiscal columns (migration 229) from updateData in case they don't exist
      delete updateData.iva_regimen
      delete updateData.iva_tasa
      delete updateData.redondeo_efectivo
      // Strip commission flag (migration 257) in case it doesn't exist yet
      delete updateData.comision_aplica_sin_reparacion
      // Strip vendedor inventory flag (migration 275) in case it doesn't exist yet
      delete updateData.vendedores_administran_inventario
      // Strip tecnico POS flag (migration 314) in case it doesn't exist yet
      delete updateData.tecnicos_operan_pos
      // Strip facturacion electronica flag (migration 296) in case it doesn't exist yet
      delete updateData.facturacion_electronica_habilitada
      const selectColsNoFiscal = "id, logo_url, logo_path, nombre_mostrar, telefono, direccion, ciudad, provincia, codigo_postal, moneda, zona_horaria, umbral_stock_bajo, iva_porcentaje, cotizacion_validez_dias, cotizacion_terminos, garantia_dias_default, politica_abandono_dias_default, anticipo_porcentaje_default, pais, modulo_agenda"
      result2 = await supabaseAdmin
        .from("organizations")
        .update(updateData)
        .eq("id", organizationId!)
        .select(selectColsNoFiscal)
        .single() as any
    }

    if (result2.error) {
      console.error("DB Error updating config:", result2.error)
      return NextResponse.json(
        { error: `Error de base de datos: ${result2.error.message || result2.error.code || JSON.stringify(result2.error)}` },
        { status: 500 }
      )
    }

    const organization = result2.data as any

    return NextResponse.json({
      id: organization.id,
      logoUrl: organization.logo_url,
      nombreEmpresa: organization.nombre_mostrar,
      telefono: organization.telefono,
      direccion: organization.direccion,
      ciudad: organization.ciudad || "",
      provincia: organization.provincia || "",
      codigoPostal: organization.codigo_postal || "",
      moneda: organization.moneda || "ARS",
      zonaHoraria: organization.zona_horaria || "America/Argentina/Buenos_Aires",
      umbralStockBajo: organization.umbral_stock_bajo ?? 5,
      ivaPorcentaje: organization.iva_porcentaje ?? 0,
      cotizacionValidezDias: organization.cotizacion_validez_dias ?? 30,
      cotizacionTerminos: organization.cotizacion_terminos || "",
      recepcionTerminos: organization.recepcion_terminos || "",
      comprobanteTerminos: organization.comprobante_terminos || "",
      garantiaDiasDefault: organization.garantia_dias_default ?? 30,
      politicaAbandonoDiasDefault: organization.politica_abandono_dias_default ?? 60,
      anticipoPorcentajeDefault: organization.anticipo_porcentaje_default ?? 50,
      pais: organization.pais || "AR",
      moduloAgenda: !!organization.modulo_agenda,
      vendedoresAdministranInventario: !!organization.vendedores_administran_inventario,
      tecnicosOperanPos: !!organization.tecnicos_operan_pos,
      ivaRegimen: organization.iva_regimen ?? "EXENTO",
      ivaTasa: organization.iva_tasa ?? getIvaGeneral(organization.pais),
      redondeoEfectivo: organization.redondeo_efectivo ?? 0,
      comisionAplicaSinReparacion: organization.comision_aplica_sin_reparacion ?? false,
      terminologia: resolveTerminologia(organization.terminologia),
      terminologiaOverrides: organization.terminologia ?? {},
      cuit: organization.cuit || "",
      condicionIva: organization.condicion_iva || "",
      domicilioFiscal: organization.domicilio_fiscal || "",
      ingresosBrutos: organization.ingresos_brutos || "",
      inicioActividades: organization.inicio_actividades || "",
      cbuAlias: organization.cbu_alias || "",
      mediosPagoTexto: organization.medios_pago_texto || "",
      plazoPagoDias: organization.plazo_pago_dias ?? null,
      facturacionElectronicaHabilitada: !!organization.facturacion_electronica_habilitada,
    })
  } catch (error: any) {
    console.error("Error updating config:", error)
    const message = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error))
    return NextResponse.json({ error: `Error al actualizar configuraciÃ³n: ${message}` }, { status: 500 })
  }
}

// DELETE - Eliminar logo (solo ADMIN)
export async function DELETE() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Eliminar de Storage
    await deleteLogo(organizationId!)

    // Actualizar DB
    const { data: organization, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({
        logo_url: null,
        logo_path: null,
      })
      .eq("id", organizationId!)
      .select("id, logo_url, nombre_mostrar")
      .single()

    if (dbError) {
      throw dbError
    }

    return NextResponse.json({
      id: organization.id,
      logoUrl: null,
      nombreEmpresa: organization.nombre_mostrar,
    })
  } catch (error) {
    console.error("Error deleting logo:", error)
    return NextResponse.json({ error: "Error al eliminar logo" }, { status: 500 })
  }
}

