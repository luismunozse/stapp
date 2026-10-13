-- M1b: guardar_grupo_variantes (change variantes-inventario-venta). Re-runnable (CREATE OR REPLACE).
-- Needs M1a applied (table inventario_grupos, columns grupo_id/atributos, key/validity/name fns).
--
-- ONE atomic call creates or edits a product group: the group row, its variants, the shared
-- fields, the initial stock of NEW variants, archive and restore. Nothing calls it until the
-- grupos PUT route exists, so applying this file changes no behavior. No locks beyond the function
-- catalog: no table is altered.
--
-- WHO CALLS IT. Only the server, through service_role (anon/authenticated lose EXECUTE below, and a
-- new function is executable by PUBLIC unless revoked). p_org is the organization of the caller's
-- SESSION, filled in by the route (the repo's RPC pattern, as in crear_recepcion_multiple); it is
-- never read from the request body. p_user must be a real users.id or NULL: an unknown one is refused
-- with 22023. It is checked against users with no organization filter on purpose (support and
-- impersonation sessions act for users of other organizations); p_org alone decides what is read or
-- written. The function is SECURITY INVOKER and filters EVERY statement by p_org, so a row of another
-- organization is never read or changed: an id that belongs to another organization is refused with
-- P0002. That answer is NOT indistinguishable from the one for an id that does not exist yet (that one
-- is created) or, for ids outside the c + 24 hex format, from the 22023 a missing id gets. Ids are
-- unguessable, so this only tells a caller who already holds an id that it is taken.
--
-- CONTRACT.
--   p_grupo        {id, nombre, opciones:[{nombre, valores:[..]}], renombrar?:bool (default true)}
--   p_compartidos  any of the 9 shared columns (the ones the M1a sync trigger fires on); a key that is
--                  present is written to the whole group, an absent key keeps the group's value
--   p_variantes    [{id, atributos, codigo, barcode?, precio_venta?, precio_compra?, stock_inicial?,
--                  stock_minimo?, stock_maximo?, punto_reorden?, ubicacion?}]; an absent key means
--                  "unchanged" (a missing precio_compra never becomes 0 on an existing row). The values
--                  in atributos are NOT cross-checked against opciones.valores (the design only requires
--                  the option names to match); fotoDeRespaldo tolerates a value the group does not list.
--   p_archivar     [id] of group members to archive (never deleted; stock, history and photo stay)
--   FULL-STATE SAVE: every ACTIVE member of an existing group must be in p_variantes or in p_archivar. A
--   call that leaves one out is refused with 22023 and the message PAYLOAD_INVALIDO:miembros_faltantes:<ids>
--   (comma separated, sorted); the caller answers 409 and the form reloads. A member left out would keep a
--   stale atributos after an option is added or renamed and a stale name after a base rename, so it is
--   refused. That is ALL this protects: only MISSING members are detected. There is no version check, so a
--   concurrent edit of a member field, of the group name or of the options is last-write-wins, and a member
--   archived meanwhile that the stale form still lists comes back as restored. That is the accepted v1
--   behavior (optimistic concurrency on the group's updated_at is a later option). Archived members need
--   not be listed: their managed names follow a base rename, so a restore starts current.
--   p_deposito_inicial  depot for the initial stock of NEW rows; NULL = the default of adjust_stock_atomic
--   Returns {grupoId, creados, actualizados, promovidos, restaurados, archivados} (id lists).
--   Rows are classified by what is in the database: NEW id -> INSERT (creados); standalone row ->
--   joins the group (promovidos, keeps id, stock, code, barcode, movements); member -> edited in place
--   (actualizados); archived member -> reactivated (restaurados). A retry with the same ids converges:
--   initial stock is applied on INSERT only, so nothing is duplicated and no second movement exists.
--
-- ERRORS (SQLSTATE -> meaning). 22023 invalid payload (shape, caps, repeated barcode, members left out, an
-- unknown p_user, a stock_minimo above the effective stock_maximo: raised BEFORE the M1a CHECK, a column
-- CHECK, a foreign key or the btree row limit could fire with a raw 23514 / 23503 / 54000), P0002 not found or other
-- organization, P0030 combination taken, P0031 item in another group, P0032 kit, P0033 reserved stock
-- blocks the archive (the whole save rolls back), P0034 over the limits, P0035 code taken
-- (CODIGO_DUPLICADO:A-1,A-2 lists every offender).
--
-- NAMES. A child name is MANAGED when it equals the name derived from the previous base and the row's
-- previous values; only managed names follow a rename. A custom name that happens to equal the old managed
-- name cannot be told apart and is re-derived on a base rename.
--
-- KNOWN LIMIT. Because existing rows are written before new ones (and archive comes first), a rename that
-- frees a combination or a code for a NEW row works in any payload order, and so does archiving a row and
-- adding another one on its code and combination in the same call. Rows are still updated one at a time
-- against unique indexes that are checked per row: a swap of two EXISTING combinations (or codes) always
-- fails with a raw 23505, and a chain among existing rows (A -> B while B -> C) fails only when the mover
-- is processed before the holder (payload order); both pass the checks above first. The caller maps 23505
-- to 409.
--
-- PROBES. verify/359_probes.sql runs in one transaction that always rolls back. Its rollback rehearsal
-- at the end of verify/359_probes.sql DROPs this function inside that transaction and the ROLLBACK
-- undoes it, so nothing is left behind. Run the probes after applying this file and before PR4 merges: that
-- is the gate, the route must not depend on an RPC whose probes have never run. Do not apply or re-apply
-- this file while they run (the DROP holds the function's object lock until the ROLLBACK). Saves in flight
-- are not expected to wait, because calling a function takes no lock on it, but that has not been tested
-- against live traffic.
--
-- LOCK ORDER. The group row first, then every touched row and every current member of the group in
-- ORDER BY id. Two saves of one group therefore serialize on the group row. A plain UPDATE of one
-- sibling (form, bulk set_category, import, v1 API) fans out through the M1a trigger in scan order and
-- can still deadlock with this function (40P01): the caller (lib/variantes-api) retries once or answers
-- a retryable error. This file cannot retry inside its own transaction.
--
-- Image columns (imagen_url, imagen_path) and the gallery are never read or written here: one stored
-- file is referenced by exactly one row, and a new variant starts without a photo of its own.

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION guardar_grupo_variantes(
  p_org TEXT, p_user TEXT, p_grupo JSONB, p_compartidos JSONB, p_variantes JSONB,
  p_archivar JSONB, p_deposito_inicial TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  c_id     CONSTANT TEXT := '^c[0-9a-f]{24}$';
  c_num    CONSTANT TEXT := '^[0-9]{1,8}(\.[0-9]{1,2})?$';
  c_int    CONSTANT TEXT := '^[0-9]{1,9}$';
  c_shared CONSTANT TEXT[] := ARRAY['descripcion', 'categoria', 'tipo_dispositivo', 'proveedor', 'proveedor_id',
                                    'dias_garantia_default', 'trackea_lotes', 'trackea_series', 'dias_alerta_vencimiento'];
  c_vkeys  CONSTANT TEXT[] := ARRAY['id', 'atributos', 'codigo', 'barcode', 'precio_venta', 'precio_compra',
                                    'stock_inicial', 'stock_minimo', 'stock_maximo', 'punto_reorden', 'ubicacion'];
  v_comp JSONB := COALESCE(p_compartidos, '{}'::jsonb);
  v_vars JSONB := COALESCE(p_variantes, '[]'::jsonb);
  v_gid TEXT; v_base TEXT; v_prev TEXT; v_ren BOOLEAN; v_ops JSONB; v_nop INT; v_prod BIGINT := 1;
  v_ids TEXT[]; v_arch TEXT[]; v_codes TEXT[]; v_n INT; v_var JSONB; v_err TEXT; v_dups TEXT; v_o JSONB; v_rid TEXT; v_rres INT;
  v_falt TEXT; v_min INT; v_max INT;
  v_cls TEXT[] := '{}'; v_nm TEXT[] := '{}'; v_sh JSONB; v_s inventario; r inventario;
  v_cre TEXT[] := '{}'; v_act TEXT[] := '{}'; v_pro TEXT[] := '{}'; v_res TEXT[] := '{}'; v_ar TEXT[] := '{}';
BEGIN
  -- 1. Shapes and limits. Nothing is read from the database before this block ends.
  IF p_org IS NULL OR btrim(p_org) = '' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_org is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_grupo) IS DISTINCT FROM 'object' OR jsonb_typeof(v_vars) <> 'array'
     OR jsonb_typeof(v_comp) <> 'object' OR jsonb_typeof(COALESCE(p_archivar, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_grupo and p_compartidos must be objects, p_variantes and p_archivar arrays' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_grupo) k WHERE k NOT IN ('id', 'nombre', 'opciones', 'renombrar')) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_grupo accepts id, nombre, opciones and renombrar only' USING ERRCODE = '22023';
  END IF;
  v_gid := p_grupo ->> 'id';
  v_base := p_grupo ->> 'nombre';
  IF jsonb_typeof(p_grupo -> 'id') IS DISTINCT FROM 'string' OR btrim(v_gid) = ''
     OR jsonb_typeof(p_grupo -> 'nombre') IS DISTINCT FROM 'string' OR btrim(v_base) = '' OR char_length(v_base) > 200
     OR (p_grupo ? 'renombrar' AND jsonb_typeof(p_grupo -> 'renombrar') <> 'boolean') THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: the group needs an id, a name of 1 to 200 characters and a boolean renombrar' USING ERRCODE = '22023';
  END IF;
  v_ren := CASE WHEN p_grupo ? 'renombrar' THEN (p_grupo ->> 'renombrar')::boolean ELSE true END;
  IF (CASE WHEN jsonb_typeof(p_grupo -> 'opciones') = 'array' THEN jsonb_array_length(p_grupo -> 'opciones') = 0 ELSE true END) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: opciones must be a non-empty array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_grupo -> 'opciones') > 3 THEN
    RAISE EXCEPTION 'LIMITE_EXCEDIDO: a group has at most 3 options' USING ERRCODE = 'P0034';
  END IF;
  SELECT m INTO v_err FROM (SELECT CASE
      WHEN jsonb_typeof(o.e) <> 'object' OR jsonb_typeof(o.e -> 'nombre') IS DISTINCT FROM 'string'
           OR btrim(o.e ->> 'nombre') = '' OR char_length(o.e ->> 'nombre') > 100 THEN 'every option needs a name of 1 to 100 characters'
      WHEN jsonb_typeof(o.e -> 'valores') IS DISTINCT FROM 'array' THEN 'every option needs a list of values'
      WHEN jsonb_array_length(o.e -> 'valores') > 100 THEN NULL
      WHEN NOT inventario_atributos_validos((SELECT jsonb_agg(jsonb_build_object('valor', x.v)) FROM jsonb_array_elements(o.e -> 'valores') x(v)))
        THEN 'option values must be non-blank text'
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(o.e -> 'valores') x(v) WHERE char_length(x.v #>> '{}') > 100)
        THEN 'option values are at most 100 characters'
      WHEN (SELECT count(DISTINCT inventario_combinacion_clave(jsonb_build_array(jsonb_build_object('valor', x.v)))) <> count(*)
              FROM jsonb_array_elements(o.e -> 'valores') x(v)) THEN 'a value is repeated inside an option'
    END AS m FROM jsonb_array_elements(p_grupo -> 'opciones') o(e)) q WHERE m IS NOT NULL LIMIT 1;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: %', v_err USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT inventario_combinacion_clave(jsonb_build_array(jsonb_build_object('valor', o.e -> 'nombre')))) <> count(*)
        FROM jsonb_array_elements(p_grupo -> 'opciones') o(e)) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: option names must be different' USING ERRCODE = '22023';
  END IF;
  FOR v_o IN SELECT o.e FROM jsonb_array_elements(p_grupo -> 'opciones') o(e) LOOP
    IF jsonb_array_length(v_o -> 'valores') > 100 THEN v_prod := 101; EXIT; END IF;
    v_prod := v_prod * jsonb_array_length(v_o -> 'valores');
  END LOOP;
  IF v_prod > 100 OR jsonb_array_length(v_vars) > 100 OR jsonb_array_length(COALESCE(p_archivar, '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'LIMITE_EXCEDIDO: at most 100 combinations, 100 rows and 100 archived ids per save' USING ERRCODE = 'P0034';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('nombre', o.e -> 'nombre', 'valores', o.e -> 'valores') ORDER BY o.n) INTO v_ops
    FROM jsonb_array_elements(p_grupo -> 'opciones') WITH ORDINALITY o(e, n);
  v_nop := jsonb_array_length(v_ops);
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_comp) k WHERE k <> ALL (c_shared)) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_compartidos accepts only the 9 shared columns' USING ERRCODE = '22023';
  END IF;
  SELECT m INTO v_err FROM (SELECT CASE
      WHEN k IN ('trackea_lotes', 'trackea_series') AND jsonb_typeof(x) <> 'boolean' THEN k || ' must be true or false'
      WHEN k IN ('dias_garantia_default', 'dias_alerta_vencimiento')
           AND NOT (jsonb_typeof(x) = 'null' OR (jsonb_typeof(x) = 'number' AND (x #>> '{}') ~ c_int)) THEN k || ' must be a whole number or null'
      WHEN k NOT IN ('trackea_lotes', 'trackea_series', 'dias_garantia_default', 'dias_alerta_vencimiento')
           AND jsonb_typeof(x) NOT IN ('string', 'null') THEN k || ' must be text or null'
      WHEN k = 'categoria' AND (jsonb_typeof(x) <> 'string' OR btrim(x #>> '{}') = '') THEN 'categoria cannot be blank'
      WHEN jsonb_typeof(x) = 'string' AND char_length(x #>> '{}') > CASE WHEN k = 'descripcion' THEN 2000 ELSE 200 END THEN k || ' is too long'
    END AS m FROM jsonb_each(v_comp) c(k, x)) q WHERE m IS NOT NULL LIMIT 1;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: %', v_err USING ERRCODE = '22023';
  END IF;
  SELECT m INTO v_err FROM (SELECT CASE
      WHEN jsonb_typeof(e.v) <> 'object' THEN 'every variante must be an object'
      WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(e.v) k WHERE k <> ALL (c_vkeys)) THEN 'a variante carries a key that is not allowed'
      WHEN jsonb_typeof(e.v -> 'id') IS DISTINCT FROM 'string' OR btrim(e.v ->> 'id') = '' THEN 'every variante needs a text id'
      WHEN CASE WHEN jsonb_typeof(e.v -> 'atributos') = 'array' THEN jsonb_array_length(e.v -> 'atributos') <> v_nop ELSE true END
        THEN 'atributos needs exactly one entry per option'
      WHEN NOT inventario_atributos_validos(e.v -> 'atributos') THEN 'atributos values must be non-blank text'
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(e.v -> 'atributos') WITH ORDINALITY a(x, o)
                    WHERE char_length(a.x ->> 'valor') > 100 OR (a.x ->> 'opcion') IS DISTINCT FROM (v_ops -> (a.o::int - 1)) ->> 'nombre')
        THEN 'atributos must follow the option names, with values of at most 100 characters'
      WHEN e.v ? 'codigo' AND NOT (jsonb_typeof(e.v -> 'codigo') = 'string' AND btrim(e.v ->> 'codigo') <> '' AND char_length(e.v ->> 'codigo') <= 100)
        THEN 'codigo must be text of 1 to 100 characters'
      WHEN EXISTS (SELECT 1 FROM jsonb_each(e.v) f(k, x) WHERE k IN ('barcode', 'ubicacion')
                    AND NOT (jsonb_typeof(x) = 'null' OR (jsonb_typeof(x) = 'string' AND char_length(x #>> '{}') <= 100)))
        THEN 'barcode and ubicacion must be text of at most 100 characters or null'
      WHEN EXISTS (SELECT 1 FROM jsonb_each(e.v) f(k, x) WHERE k IN ('precio_venta', 'precio_compra')
                    AND NOT (jsonb_typeof(x) = 'number' AND (x #>> '{}') ~ c_num))
        THEN 'prices must be numbers from 0 to 99999999.99 with at most 2 decimals'
      WHEN EXISTS (SELECT 1 FROM jsonb_each(e.v) f(k, x) WHERE k IN ('stock_inicial', 'stock_minimo', 'stock_maximo', 'punto_reorden')
                    AND NOT ((jsonb_typeof(x) = 'number' AND (x #>> '{}') ~ c_int) OR (k <> 'stock_inicial' AND jsonb_typeof(x) = 'null')))
        THEN 'stock fields must be whole numbers from 0 to 999999999 (null is allowed only for the thresholds)'
    END AS m FROM jsonb_array_elements(v_vars) e(v)) q WHERE m IS NOT NULL LIMIT 1;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: %', v_err USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT e.v ->> 'id' FROM jsonb_array_elements(v_vars) WITH ORDINALITY e(v, n) ORDER BY e.n);
  v_n := COALESCE(array_length(v_ids, 1), 0);
  IF (SELECT count(DISTINCT i) FROM unnest(v_ids) i) <> v_n THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: a variante id is repeated' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_vars) e(v) WHERE btrim(COALESCE(e.v ->> 'barcode', '')) <> ''
              GROUP BY btrim(e.v ->> 'barcode') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: a barcode is repeated inside the save' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_archivar, '[]'::jsonb)) a(x)
              WHERE jsonb_typeof(a.x) <> 'string' OR btrim(a.x #>> '{}') = '') THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_archivar holds text ids' USING ERRCODE = '22023';
  END IF;
  v_arch := ARRAY(SELECT DISTINCT a.x #>> '{}' FROM jsonb_array_elements(COALESCE(p_archivar, '[]'::jsonb)) a(x));
  IF v_arch && v_ids THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: an id cannot be saved and archived in the same call' USING ERRCODE = '22023';
  END IF;

  -- 2. The group: lock it (keeping the PREVIOUS base name for the naming rule), then upsert it. A group
  -- id that another organization owns returns no row: P0002. p_user is checked here, the first read.
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_user is not a known user' USING ERRCODE = '22023';
  END IF;
  SELECT nombre INTO v_prev FROM inventario_grupos WHERE id = v_gid AND organization_id = p_org FOR UPDATE;
  IF NOT FOUND AND v_gid !~ c_id THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: a new group id looks like c + 24 hex characters' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND AND v_n = 0 THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: a new group needs at least one variante' USING ERRCODE = '22023';
  END IF;
  INSERT INTO inventario_grupos (id, organization_id, nombre, opciones, created_by) VALUES (v_gid, p_org, v_base, v_ops, p_user)
  ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, opciones = EXCLUDED.opciones
   WHERE inventario_grupos.organization_id = p_org
  RETURNING id INTO v_gid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ENCONTRADO: group %', p_grupo ->> 'id' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Lock every touched row and every current member in id order, then classify. A row of another
  -- organization is neither locked nor read here; an id found only in another organization is P0002.
  PERFORM 1 FROM inventario WHERE organization_id = p_org AND (id = ANY (v_ids || v_arch) OR grupo_id = v_gid) ORDER BY id FOR UPDATE;
  FOR v_i IN 1 .. v_n LOOP
    v_var := v_vars -> (v_i - 1);
    SELECT * INTO r FROM inventario WHERE id = v_ids[v_i] AND organization_id = p_org;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM inventario WHERE id = v_ids[v_i]) THEN
        RAISE EXCEPTION 'NO_ENCONTRADO: item %', v_ids[v_i] USING ERRCODE = 'P0002';
      END IF;
      IF v_ids[v_i] !~ c_id OR NOT v_var ? 'codigo' THEN
        RAISE EXCEPTION 'PAYLOAD_INVALIDO: a new variante needs an id like c + 24 hex characters and a codigo' USING ERRCODE = '22023';
      END IF;
      v_cls := v_cls || 'N'::text;
      v_nm := v_nm || inventario_nombre_variante(v_base, v_var -> 'atributos');
      v_min := (v_var ->> 'stock_minimo')::int;
      v_max := (v_var ->> 'stock_maximo')::int;
    ELSIF r.deleted_at IS NOT NULL AND r.grupo_id IS DISTINCT FROM v_gid THEN
      RAISE EXCEPTION 'NO_ENCONTRADO: item %', r.id USING ERRCODE = 'P0002';
    ELSIF r.grupo_id <> v_gid THEN
      RAISE EXCEPTION 'ITEM_EN_OTRO_GRUPO: %', r.id USING ERRCODE = 'P0031';
    ELSIF r.es_kit THEN
      RAISE EXCEPTION 'KIT_NO_PERMITIDO: %', r.id USING ERRCODE = 'P0032';
    ELSE
      v_cls := v_cls || (CASE WHEN r.grupo_id IS NULL THEN 'P' WHEN r.deleted_at IS NOT NULL THEN 'R' ELSE 'A' END);
      v_nm := v_nm || (CASE v_cls[v_i]
        WHEN 'P' THEN CASE WHEN v_ren THEN inventario_nombre_variante(v_base, v_var -> 'atributos') ELSE r.nombre END
        ELSE CASE WHEN r.nombre = inventario_nombre_variante(v_prev, r.atributos)
                  THEN inventario_nombre_variante(v_base, v_var -> 'atributos') ELSE r.nombre END END);
      v_min := CASE WHEN v_var ? 'stock_minimo' THEN (v_var ->> 'stock_minimo')::int ELSE r.stock_minimo END;
      v_max := CASE WHEN v_var ? 'stock_maximo' THEN (v_var ->> 'stock_maximo')::int ELSE r.stock_maximo END;
    END IF;
    IF v_min > v_max THEN
      RAISE EXCEPTION 'PAYLOAD_INVALIDO: stock_minimo cannot exceed stock_maximo' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(v_arch) a(id) WHERE NOT EXISTS
              (SELECT 1 FROM inventario i WHERE i.id = a.id AND i.organization_id = p_org AND i.grupo_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'NO_ENCONTRADO: an archived id is not a member of any group' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM inventario i WHERE i.id = ANY (v_arch) AND i.organization_id = p_org AND i.grupo_id <> v_gid) THEN
    RAISE EXCEPTION 'ITEM_EN_OTRO_GRUPO: an archived id belongs to another group' USING ERRCODE = 'P0031';
  END IF;
  SELECT i.id, i.stock_reservado INTO v_rid, v_rres FROM inventario i
   WHERE i.id = ANY (v_arch) AND i.organization_id = p_org AND i.deleted_at IS NULL AND i.stock_reservado > 0 ORDER BY i.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'STOCK_RESERVADO:%:%', v_rid, v_rres USING ERRCODE = 'P0033';
  END IF;
  -- Full-state save: after this call every ACTIVE member is a payload row, so no stale member survives.
  SELECT string_agg(i.id, ',' ORDER BY i.id) INTO v_falt FROM inventario i
   WHERE i.organization_id = p_org AND i.grupo_id = v_gid AND i.deleted_at IS NULL AND NOT (i.id = ANY (v_ids || v_arch));
  IF v_falt IS NOT NULL THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO:miembros_faltantes:%', v_falt USING ERRCODE = '22023';
  END IF;

  -- 4. Combinations and codes that would collide once the save lands. Every active member is in the
  -- payload (or archived by this call), so the payload rows ARE the final active set of the group; the
  -- codes are also checked against the other active rows of the organization (rows archived by this call
  -- free their code).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_vars) e(v) GROUP BY inventario_combinacion_clave(e.v -> 'atributos') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'COMBINACION_DUPLICADA' USING ERRCODE = 'P0030';
  END IF;
  v_codes := ARRAY(SELECT COALESCE(e.v ->> 'codigo', i.codigo)
                     FROM jsonb_array_elements(v_vars) e(v) LEFT JOIN inventario i ON i.id = e.v ->> 'id' AND i.organization_id = p_org);
  SELECT string_agg(u.c, ',' ORDER BY u.c) INTO v_dups FROM (
    SELECT c FROM (
      SELECT unnest(v_codes) AS c
      UNION ALL
      SELECT i.codigo FROM inventario i
       WHERE i.organization_id = p_org AND i.deleted_at IS NULL AND NOT (i.id = ANY (v_ids || v_arch)) AND i.codigo = ANY (v_codes)
    ) x GROUP BY c HAVING count(*) > 1) u;
  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'CODIGO_DUPLICADO:%', v_dups USING ERRCODE = 'P0035';
  END IF;

  -- 5. Shared fields every row of the group must end with: the group's current values (or, for a new
  -- group, those of the first promoted row) overlaid with the keys of p_compartidos. Members of a group
  -- always agree (the M1a trigger), so which member is read does not matter.
  SELECT jsonb_build_object('descripcion', i.descripcion, 'categoria', i.categoria, 'tipo_dispositivo', i.tipo_dispositivo,
           'proveedor', i.proveedor, 'proveedor_id', i.proveedor_id, 'dias_garantia_default', i.dias_garantia_default,
           'trackea_lotes', i.trackea_lotes, 'trackea_series', i.trackea_series, 'dias_alerta_vencimiento', i.dias_alerta_vencimiento)
    INTO v_sh FROM inventario i
   WHERE i.organization_id = p_org AND (i.grupo_id = v_gid OR i.id = ANY (v_ids))
   ORDER BY (i.grupo_id = v_gid) DESC NULLS LAST, i.id LIMIT 1;
  v_s := jsonb_populate_record(NULL::inventario, COALESCE(v_sh, '{}'::jsonb) || v_comp);
  v_s.trackea_lotes := COALESCE(v_s.trackea_lotes, false);
  v_s.trackea_series := COALESCE(v_s.trackea_series, false);
  IF v_s.categoria IS NULL AND 'N' = ANY (v_cls) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO: categoria is required to create variants in a new group' USING ERRCODE = '22023';
  END IF;
  IF v_comp ? 'proveedor_id' AND v_s.proveedor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM proveedores WHERE id = v_s.proveedor_id AND organization_id = p_org) THEN
    RAISE EXCEPTION 'NO_ENCONTRADO: proveedor %', v_s.proveedor_id USING ERRCODE = 'P0002';
  END IF;
  IF p_deposito_inicial IS NOT NULL AND 'N' = ANY (v_cls)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_vars) WITH ORDINALITY e(v, n)
                  WHERE v_cls[e.n::int] = 'N' AND COALESCE((e.v ->> 'stock_inicial')::int, 0) > 0)
     AND NOT EXISTS (SELECT 1 FROM depositos WHERE id = p_deposito_inicial AND organization_id = p_org AND activo AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NO_ENCONTRADO: deposito %', p_deposito_inicial USING ERRCODE = 'P0002';
  END IF;

  -- 6. Writes, in this order: archive (it frees slots and codes), EXISTING rows (a rename frees a slot or a
  -- code for a new row in any payload order), NEW rows, the names of archived members, and the group-wide
  -- shared update.
  WITH a AS (UPDATE inventario SET deleted_at = NOW(), deleted_by = p_user
              WHERE organization_id = p_org AND id = ANY (v_arch) AND deleted_at IS NULL RETURNING id)
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_ar FROM a;
  FOR v_i IN 1 .. v_n LOOP
    IF v_cls[v_i] <> 'N' THEN
      v_var := v_vars -> (v_i - 1);
      UPDATE inventario SET
        grupo_id = v_gid, atributos = v_var -> 'atributos', nombre = v_nm[v_i], deleted_at = NULL, deleted_by = NULL,
        codigo = COALESCE(v_var ->> 'codigo', codigo),
        barcode = CASE WHEN v_var ? 'barcode' THEN NULLIF(btrim(v_var ->> 'barcode'), '') ELSE barcode END,
        ubicacion = CASE WHEN v_var ? 'ubicacion' THEN NULLIF(btrim(v_var ->> 'ubicacion'), '') ELSE ubicacion END,
        precio_venta = CASE WHEN v_var ? 'precio_venta' THEN (v_var ->> 'precio_venta')::numeric ELSE precio_venta END,
        precio_compra = CASE WHEN v_var ? 'precio_compra' THEN (v_var ->> 'precio_compra')::numeric ELSE precio_compra END,
        stock_minimo = CASE WHEN v_var ? 'stock_minimo' THEN (v_var ->> 'stock_minimo')::int ELSE stock_minimo END,
        stock_maximo = CASE WHEN v_var ? 'stock_maximo' THEN (v_var ->> 'stock_maximo')::int ELSE stock_maximo END,
        punto_reorden = CASE WHEN v_var ? 'punto_reorden' THEN (v_var ->> 'punto_reorden')::int ELSE punto_reorden END
       WHERE id = v_ids[v_i] AND organization_id = p_org;
      IF v_cls[v_i] = 'A' THEN v_act := v_act || v_ids[v_i];
      ELSIF v_cls[v_i] = 'P' THEN v_pro := v_pro || v_ids[v_i];
      ELSE v_res := v_res || v_ids[v_i]; END IF;
    END IF;
  END LOOP;
  FOR v_i IN 1 .. v_n LOOP
    v_var := v_vars -> (v_i - 1);
    IF v_cls[v_i] = 'N' THEN
      INSERT INTO inventario (id, organization_id, codigo, nombre, descripcion, categoria, tipo_dispositivo, proveedor, proveedor_id,
                              dias_garantia_default, trackea_lotes, trackea_series, dias_alerta_vencimiento, stock, precio_compra,
                              precio_venta, stock_minimo, stock_maximo, punto_reorden, barcode, ubicacion, grupo_id, atributos)
      VALUES (v_ids[v_i], p_org, v_var ->> 'codigo', v_nm[v_i], v_s.descripcion, v_s.categoria, v_s.tipo_dispositivo, v_s.proveedor,
              v_s.proveedor_id, v_s.dias_garantia_default, v_s.trackea_lotes, v_s.trackea_series,
              v_s.dias_alerta_vencimiento, 0, COALESCE((v_var ->> 'precio_compra')::numeric, 0), COALESCE((v_var ->> 'precio_venta')::numeric, 0),
              (v_var ->> 'stock_minimo')::int, (v_var ->> 'stock_maximo')::int, (v_var ->> 'punto_reorden')::int,
              NULLIF(btrim(v_var ->> 'barcode'), ''), NULLIF(btrim(v_var ->> 'ubicacion'), ''), v_gid, v_var -> 'atributos');
      IF COALESCE((v_var ->> 'stock_inicial')::int, 0) > 0 THEN
        PERFORM adjust_stock_atomic(v_ids[v_i], p_org, p_user, 'delta', (v_var ->> 'stock_inicial')::int,
                                    'Stock inicial de variante', 'ENTRADA', 'STOCK_INICIAL', p_deposito_inicial);
      END IF;
      v_cre := v_cre || v_ids[v_i];
    END IF;
  END LOOP;
  -- A base rename also reaches the ARCHIVED members whose name is still the managed one, so restoring
  -- one later starts from the current base (a custom name stays as it is).
  IF v_prev IS NOT NULL AND v_prev <> v_base THEN
    UPDATE inventario SET nombre = inventario_nombre_variante(v_base, atributos)
     WHERE organization_id = p_org AND grupo_id = v_gid AND deleted_at IS NOT NULL
       AND nombre = inventario_nombre_variante(v_prev, atributos);
  END IF;
  PERFORM set_config('stapp.sync_grupo', 'on', true);
  UPDATE inventario i SET descripcion = v_s.descripcion, categoria = v_s.categoria, tipo_dispositivo = v_s.tipo_dispositivo,
         proveedor = v_s.proveedor, proveedor_id = v_s.proveedor_id, dias_garantia_default = v_s.dias_garantia_default,
         trackea_lotes = v_s.trackea_lotes, trackea_series = v_s.trackea_series,
         dias_alerta_vencimiento = v_s.dias_alerta_vencimiento
   WHERE i.organization_id = p_org AND i.grupo_id = v_gid
     AND (i.descripcion, i.categoria, i.tipo_dispositivo, i.proveedor, i.proveedor_id, i.dias_garantia_default,
          i.trackea_lotes, i.trackea_series, i.dias_alerta_vencimiento)
         IS DISTINCT FROM
         (v_s.descripcion, v_s.categoria, v_s.tipo_dispositivo, v_s.proveedor, v_s.proveedor_id, v_s.dias_garantia_default,
          v_s.trackea_lotes, v_s.trackea_series, v_s.dias_alerta_vencimiento);
  PERFORM set_config('stapp.sync_grupo', 'off', true);

  RETURN jsonb_build_object('grupoId', v_gid, 'creados', to_jsonb(v_cre), 'actualizados', to_jsonb(v_act),
                            'promovidos', to_jsonb(v_pro), 'restaurados', to_jsonb(v_res), 'archivados', to_jsonb(v_ar));
END;
$$;

COMMENT ON FUNCTION guardar_grupo_variantes(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT) IS
  'Crea o edita un grupo de variantes en una transaccion: grupo, filas por id, compartidos, stock inicial, archivo y restauracion. Solo service_role. Ver el encabezado de la migracion.';

-- New functions are executable by PUBLIC (and by anon/authenticated through Supabase default privileges).
REVOKE EXECUTE ON FUNCTION guardar_grupo_variantes(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION guardar_grupo_variantes(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT) TO service_role;
