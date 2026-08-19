"use client";

import { useState } from "react";

// Esquema do usuário (2026-08-19): prefixo de letras por categoria (CA =
// corrente aço, CP = corrente prata, ...) + número sequencial (00, 01, 02...)
// dentro daquele prefixo. Esse componente não impõe o prefixo (texto livre,
// como sempre foi codigo_interno) — só ajuda a enxergar em que número o
// prefixo digitado está, pra não repetir/pular sem querer.
export function sugerirProximoCodigo(
  digitado: string,
  codigosExistentes: string[],
): { codigosDoPrefixo: string[]; sugestao: string | null } {
  const prefixo = (digitado.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
  if (!prefixo) return { codigosDoPrefixo: [], sugestao: null };

  const doPrefixo = codigosExistentes.filter((c) => c.toUpperCase().startsWith(prefixo));
  let maiorNumero = -1;
  let digitos = 2;
  for (const codigo of doPrefixo) {
    const resto = codigo.slice(prefixo.length);
    if (!/^\d+$/.test(resto)) continue;
    digitos = Math.max(digitos, resto.length);
    maiorNumero = Math.max(maiorNumero, Number(resto));
  }
  if (maiorNumero < 0) return { codigosDoPrefixo: doPrefixo, sugestao: `${prefixo}${"0".repeat(digitos - 1)}0` };

  return {
    codigosDoPrefixo: doPrefixo,
    sugestao: `${prefixo}${String(maiorNumero + 1).padStart(digitos, "0")}`,
  };
}

export function CampoCodigoProduto({
  defaultValue,
  codigosExistentes,
  obrigatorio,
  dica,
}: {
  defaultValue?: string | null;
  codigosExistentes: string[];
  obrigatorio?: boolean;
  dica?: string;
}) {
  const [valor, setValor] = useState(defaultValue ?? "");
  const { codigosDoPrefixo, sugestao } = sugerirProximoCodigo(valor, codigosExistentes);
  // Já em uso pelo próprio código digitado (ex: editando "CA03" e o prefixo
  // "CA" já inclui "CA03" na lista) não deve contar como conflito.
  const jaExiste = valor.trim() !== "" && codigosExistentes.some((c) => c.toUpperCase() === valor.trim().toUpperCase() && c.toUpperCase() !== (defaultValue ?? "").toUpperCase());

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="codigo_interno" className="text-xs font-semibold uppercase tracking-wide text-text-soft">
        Código
      </label>
      <input
        id="codigo_interno"
        name="codigo_interno"
        value={valor}
        onChange={(e) => setValor(e.target.value.toUpperCase())}
        required={obrigatorio}
        placeholder="Ex: CA00"
        className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
      />
      {jaExiste && <p className="text-[0.7rem] font-semibold text-crit">Esse código já está em uso.</p>}
      {!jaExiste && sugestao && (
        <p className="text-[0.7rem] text-text-soft">
          {codigosDoPrefixo.length > 0
            ? `${codigosDoPrefixo.length} código(s) já usam esse prefixo — próximo sugerido:`
            : "Prefixo novo — sugestão:"}{" "}
          <strong className="text-rose-deep">{sugestao}</strong>
        </p>
      )}
      {!sugestao && dica && <p className="text-[0.7rem] text-text-soft">{dica}</p>}
    </div>
  );
}
