-- ============================================================================
-- 325: facturación ARCA delegada — un certificado de plataforma para N talleres
-- ============================================================================
-- El modelo BYO de la migración 299 le pide a cada taller que genere un CSR
-- con openssl, lo suba a Administración de Certificados Digitales, cree un
-- alias y asocie el web service. Seis pasos técnicos: la adopción real de eso
-- tiende a cero.
--
-- La delegación invierte el reparto. El taller hace UN trámite web
-- (Administrador de Relaciones -> Facturación Electrónica -> CUIT de STApp) y
-- la plataforma firma con SU propio certificado, emitiendo con `Auth.Cuit` =
-- CUIT del taller. El comprobante sale a nombre del taller, con su CUIT y su
-- punto de venta; STApp es el representante técnico, no el emisor.
--
-- POR QUÉ LA FILA DELEGADA NO PUEDE GUARDAR CERTIFICADO
--
-- El certificado de la plataforma es uno solo y no es dato de ningún tenant:
-- vive en variables de entorno (ARCA_STAPP_CERT_B64 / ARCA_STAPP_KEY_B64 /
-- ARCA_STAPP_CUIT), no en esta tabla. Una fila 'arca_delegado' aporta
-- únicamente la identidad fiscal del taller: cuit, punto_venta y
-- condicion_fiscal.
--
-- El CHECK `facturacion_credenciales_arca_completa` (migración 299) exige
-- cert + key + cuit, pero está escrito como `provider <> 'arca' OR (...)`, así
-- que una fila 'arca_delegado' lo satisface sola. No hay que tocarlo.
-- ============================================================================

-- 'arca_delegado' es un proveedor nuevo, no una variante de 'arca': el código
-- que resuelve credenciales toma caminos distintos (uno descifra el cert de la
-- fila, el otro lo lee del entorno) y mezclarlos en un solo valor obligaría a
-- adivinar cuál es cuál mirando si las columnas están en NULL.
ALTER TABLE facturacion_credenciales DROP CONSTRAINT IF EXISTS facturacion_credenciales_provider_check;
ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_provider_check
  CHECK (provider IN ('arca', 'arca_delegado', 'tusfacturas'));

-- Sin CUIT del taller no hay `Auth.Cuit` que mandar: la emisión sería contra
-- el CUIT de la plataforma, que es exactamente lo que NO queremos.
ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_delegado_completa
  CHECK (provider <> 'arca_delegado' OR cuit IS NOT NULL);

-- Higiene de material sensible: una org que pasa de 'arca' a 'arca_delegado'
-- deja de usar su certificado, y dejarlo cifrado en la fila es guardar una
-- clave privada que ya no cumple ninguna función. El CHECK obliga a que el
-- cambio de modelo la borre explícitamente en vez de olvidarla ahí.
ALTER TABLE facturacion_credenciales ADD CONSTRAINT facturacion_credenciales_delegado_sin_cert
  CHECK (provider <> 'arca_delegado' OR (cert_pem_enc IS NULL AND key_pem_enc IS NULL));

COMMENT ON COLUMN facturacion_credenciales.provider IS
  'arca = certificado propio del taller (BYO) | arca_delegado = firma el certificado de la plataforma y el taller solo aporta su CUIT | tusfacturas = proveedor externo (legacy)';

COMMENT ON COLUMN facturacion_credenciales.cuit IS
  'CUIT del CONTRIBUYENTE dueño de la fila. En arca es el del certificado; en arca_delegado es el representado, el que viaja en Auth.Cuit.';
