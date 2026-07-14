const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = [
  "dez",
  "onze",
  "doze",
  "treze",
  "catorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];

function tresDigitos(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (centena > 0) partes.push(CENTENAS[centena]);
  if (resto > 0) {
    if (resto < 10) partes.push(UNIDADES[resto]);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
    else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(DEZENAS[dezena] + (unidade > 0 ? ` e ${UNIDADES[unidade]}` : ""));
    }
  }
  return partes.join(" e ");
}

function extensoInteiro(n: number): string {
  if (n === 0) return "zero";

  const bilhoes = Math.floor(n / 1_000_000_000);
  const milhoes = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const grupos: { valor: number; texto: string }[] = [];
  if (bilhoes > 0) {
    grupos.push({ valor: bilhoes, texto: `${tresDigitos(bilhoes)} ${bilhoes === 1 ? "bilhão" : "bilhões"}` });
  }
  if (milhoes > 0) {
    grupos.push({ valor: milhoes, texto: `${tresDigitos(milhoes)} ${milhoes === 1 ? "milhão" : "milhões"}` });
  }
  if (milhares > 0) {
    grupos.push({ valor: milhares, texto: milhares === 1 ? "mil" : `${tresDigitos(milhares)} mil` });
  }
  if (resto > 0) {
    grupos.push({ valor: resto, texto: tresDigitos(resto) });
  }

  if (grupos.length === 1) return grupos[0].texto;

  const ultimo = grupos[grupos.length - 1];
  // Regra tradicional: liga com "e" o último grupo quando ele é < 100 (ou
  // uma centena redonda) — os grupos anteriores ficam separados por vírgula.
  const usaE = ultimo.valor < 100 || ultimo.valor % 100 === 0;
  const textos = grupos.map((g) => g.texto);
  const inicio = textos.slice(0, -1).join(", ");
  return `${inicio}${usaE ? " e " : ", "}${textos[textos.length - 1]}`;
}

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** "2026-07-26" -> "vinte e seis de Julho de 2026" */
export function dataPorExtenso(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const diaTexto = dia === 1 ? "primeiro" : extensoInteiro(dia);
  return `${diaTexto} de ${MESES[mes - 1]} de ${ano}`;
}

/** "447.03" -> "QUATROCENTOS E QUARENTA E SETE REAIS E TRÊS CENTAVOS" */
export function valorPorExtenso(valor: number): string {
  let reais = Math.floor(valor);
  let centavos = Math.round((valor - reais) * 100);
  // Arredondamento de ponto flutuante pode levar centavos a 100 (ex:
  // 10.995 -> reais=10, centavos=100) — precisa carregar pro real seguinte.
  if (centavos === 100) {
    reais += 1;
    centavos = 0;
  }

  const partes: string[] = [];
  if (reais > 0 || centavos === 0) {
    partes.push(`${extensoInteiro(reais)} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    partes.push(`${extensoInteiro(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  return partes.join(" e ").toUpperCase();
}
