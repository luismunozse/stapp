/**
 * Filtro para el `onValueChange` de un <Select> cuyo valor se setea POR CODIGO
 * y no solo eligiendolo del listado.
 *
 * Radix monta un <select> nativo invisible al lado de cada trigger para que el
 * formulario tenga un control real (`SelectBubbleInput`, en
 * @radix-ui/react-select). Cuando el valor cambia DESDE AFUERA, ese componente
 * hace `select.value = nuevo` y dispara un `change` a mano. Las <option> de ese
 * select las registran los <SelectItem>, que solo estan montados mientras el
 * listado esta abierto: con el listado cerrado no hay ninguna opcion, asignarle
 * un valor que no existe deja el select en "" y el `change` que se dispara
 * enseguida devuelve ese "" por `onValueChange`. El componente se pisa a si
 * mismo el campo que acaba de setear.
 *
 * Casi no se notaba porque los caminos habituales que setean estos campos por
 * codigo lo hacen con el Select DESMONTADO (los formularios de inventario lo
 * reemplazan por un input inline mientras se crea un tipo o una categoria) o con
 * el valor ya puesto en el estado inicial, o sea antes de que exista un valor
 * anterior contra el cual comparar. Restaurar un borrador
 * (hooks/use-form-draft.ts) es el primer caso que cambia el valor de un Select
 * ya montado, y ahi el borrador volvia con los campos de Select en blanco.
 *
 * Un "" nunca puede venir de una eleccion real: Radix rechaza un SelectItem con
 * `value=""`. Por eso alcanza con ignorarlo para separar el eco del control
 * oculto de lo que hizo el operador, sin adivinar nada.
 */
export function ignoreSelectEcho(
  apply: (value: string) => void
): (value: string) => void {
  return (value: string) => {
    if (!value) return
    apply(value)
  }
}
