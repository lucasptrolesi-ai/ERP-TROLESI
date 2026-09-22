/**
 * Dinheiro no app (regra 6 do módulo de varejo).
 *
 * `arredondarMoeda` é a ÚNICA função de arredondamento monetário do app: HALF_UP (o empate afasta do
 * zero), espelho de `public.arredondar_moeda()` no banco. Ela decide o empate sobre a representação
 * decimal em texto, em centavos inteiros, e nunca compara float (1.005 vira 1.01).
 */
function decimalEmTexto(valor: number | string): string {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return "0";
    // String(n) já é a menor representação decimal que identifica o número (1.005 -> "1.005").
    const texto = String(valor);
    return /e/i.test(texto) ? valor.toFixed(12) : texto;
  }
  return valor.trim().replace(",", ".");
}

export function arredondarMoeda(valor: number | string): number {
  const partes = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(decimalEmTexto(valor));
  if (!partes) return 0;
  const inteira = partes[2] ?? "";
  const fracao = partes[3] ?? "";
  if (inteira === "" && fracao === "") return 0;
  const decimais = fracao.padEnd(3, "0");
  let centavos = Number(inteira === "" ? "0" : inteira) * 100 + Number(decimais.slice(0, 2));
  if (decimais.charCodeAt(2) >= 53) centavos += 1; // terceiro dígito >= 5 arredonda para cima (afasta do zero)
  const resultado = centavos / 100;
  return partes[1] === "-" && centavos !== 0 ? -resultado : resultado;
}

/** Lê o que o operador digitou ("1.234,56", "12,5", "12.50", "1.000") e arredonda; null se não for número. */
export function lerMoeda(texto: string): number | null {
  const limpo = texto.trim().replace(/[^\d.,-]/g, "");
  if (limpo === "") return null;
  // Com vírgula: o ponto é separador de milhar (ex.: "1.234,56"). Sem vírgula, mas no padrão
  // brasileiro de milhar — grupos de exatamente 3 dígitos após cada ponto, sem sobra (ex.: "1.000",
  // "12.345.678") — o ponto também é separador de milhar, nunca decimal: ninguém digita fração de
  // centavo, então "1.000" é mil reais, não R$1,00 (achado no code review, 2026-09-22). Qualquer
  // outro padrão sem vírgula (ex.: "12.5", "12.50") mantém o ponto como decimal.
  const normal = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(limpo)
      ? limpo.replace(/\./g, "")
      : limpo;
  const numero = Number(normal);
  return Number.isFinite(numero) ? arredondarMoeda(numero) : null;
}
