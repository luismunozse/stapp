-- Rollback of M1b (guardar_grupo_variantes). Drops the function only: data is untouched.
-- Groups, variants, stock and photos stay exactly as they are; the M1a objects stay too.
--
-- Revert the callers first: the grupos PUT route (lib/variantes-api) calls this function, and
-- every save answers an error once it is gone. Nothing needs to be exported: no table is changed.
-- The function catalog is the only thing locked.

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS guardar_grupo_variantes(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT);
