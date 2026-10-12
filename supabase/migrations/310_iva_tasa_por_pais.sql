-- Migration 310: iva_tasa deja de tener default fijo, para que lo resuelva el pais.
--
-- La migracion 229 creo organizations.iva_tasa como NOT NULL DEFAULT 21. Ese 21
-- es la alicuota general argentina, asi que toda org nueva nacia con la tasa de
-- Argentina sin importar su pais. Un cliente chileno (19%) arrancaba mal y solo
-- se enteraba si revisaba Configuracion.
--
-- Ahora la columna admite NULL con el significado "sin tasa propia: usar la del
-- pais de la org". La resuelve la app en lib/countries.ts (getIvaGeneral), que
-- tiene la tasa general de cada pais: AR 21, CL 19, MX 16, PE 18, UY 22, ...
--
-- Ojo: la tasa general NO es el maximo de las alicuotas ofrecidas. Argentina
-- ofrece 27% para servicios regulados pero su tasa general sigue siendo 21%.

ALTER TABLE organizations
  ALTER COLUMN iva_tasa DROP DEFAULT,
  ALTER COLUMN iva_tasa DROP NOT NULL;

-- Limpieza acotada a las filas que nunca configuraron IVA.
--
-- iva_regimen = 'EXENTO' es el default de la 229 y significa que la org no
-- discrimina IVA: mientras siga ahi, iva_tasa esta inerte (los caminos de venta
-- y facturacion solo la aplican con regimen INCLUIDO o ADITIVO). En esas filas
-- el 21 es el default que nadie eligio, no una decision, y dejarlo escrito le
-- ganaria al pais el dia que la org active IVA.
--
-- Las orgs con regimen INCLUIDO o ADITIVO quedan intactas: ahi el 21 puede ser
-- una tasa elegida a mano y facturada, y no se toca.
--
-- Para una org argentina el efecto es nulo: getIvaGeneral('AR') devuelve 21,
-- el mismo valor que se borra.
UPDATE organizations
SET iva_tasa = NULL
WHERE iva_regimen = 'EXENTO'
  AND iva_tasa = 21;
