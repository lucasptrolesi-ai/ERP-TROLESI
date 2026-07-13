/** Preenche um campo de um form não-controlado via DOM — usado pra aplicar
 * resultado de busca externa (ex: CNPJ) sem converter o form pra controlado. */
export function preencherCampo(form: HTMLFormElement, nome: string, valor: string | null) {
  const campo = form.elements.namedItem(nome);
  if (campo instanceof HTMLInputElement && valor) campo.value = valor;
}
