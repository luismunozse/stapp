/**
 * Tope de clientes que una busqueda mete en un filtro `cliente_id.in.(...)`.
 *
 * PostgREST recibe los filtros en la URL. Un termino generico ("a", "1", un
 * prefijo de telefono) matchea cientos de clientes en una organizacion grande y
 * la lista de ids pasa los ~16 KB que acepta el gateway: la consulta entera
 * vuelve con 400 "Bad Request" y el listado queda vacio. Con 300 ids la URL
 * queda en ~8 KB. Si hay mas coincidencias se toman los clientes mas recientes
 * (los ids son ordenables por fecha de alta); los demas filtros de la busqueda
 * (equipo, codigo, marca, IMEI, numero) siguen aplicando completos.
 */
export const MAX_CLIENTES_EN_BUSQUEDA = 300
