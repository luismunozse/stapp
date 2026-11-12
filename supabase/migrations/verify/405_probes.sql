-- Verificación de 405: la columna existe, es boolean NOT NULL DEFAULT false y
-- ninguna org quedó habilitada. Debe devolver 1 fila con habilitadas = 0.
SELECT c.data_type, c.is_nullable, c.column_default,
       (SELECT COUNT(*) FROM organizations WHERE tecnicos_ven_deuda_clientes) AS habilitadas
FROM information_schema.columns c
WHERE c.table_name = 'organizations' AND c.column_name = 'tecnicos_ven_deuda_clientes';
