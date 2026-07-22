"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { FormField } from "@/components/form-field";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { hojeIso } from "@/lib/datas";
import { parseMoeda } from "@/lib/parse-moeda";
import type { DadosBaixa, DadosBaixaLote } from "@/lib/actions/financeiro";
import type { FormaPagamento } from "@/lib/types";

type Props =
  | {
      aberto: boolean;
      onFechar: () => void;
      titulo: string;
      modo: "individual";
      valorSugerido?: number;
      aoConfirmar: (dados: DadosBaixa) => Promise<{ erro?: string }>;
    }
  | {
      aberto: boolean;
      onFechar: () => void;
      titulo: string;
      modo: "lote";
      aoConfirmar: (dados: DadosBaixaLote) => Promise<{ erro?: string }>;
    };

export function BaixaContaModal(props: Props) {
  const { aberto, onFechar, titulo, modo } = props;
  const valorSugerido = modo === "individual" ? props.valorSugerido : undefined;

  const [pagoEm, setPagoEm] = useState(hojeIso());
  const [valorPago, setValorPago] = useState(valorSugerido != null ? String(valorSugerido) : "");
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("dinheiro");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const resultado =
        props.modo === "individual"
          ? await props.aoConfirmar({
              pago_em: pagoEm,
              valor_pago: parseMoeda(valorPago),
              forma_pagamento: formaPagamento,
              observacao: observacao.trim() || null,
            })
          : await props.aoConfirmar({ pago_em: pagoEm, forma_pagamento: formaPagamento });
      if (resultado.erro) setErro(resultado.erro);
      else onFechar();
    });
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={titulo}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirmar();
        }}
        className="flex flex-col gap-4"
      >
        <FormField
          label="Data do pagamento"
          name="pago_em"
          type="date"
          defaultValue={pagoEm}
          onChange={(e) => setPagoEm(e.target.value)}
          required
        />

        {modo === "individual" && (
          <FormField
            label="Valor pago (R$)"
            name="valor_pago"
            type="number"
            step="0.01"
            min={0.01}
            defaultValue={valorPago}
            onChange={(e) => setValorPago(e.target.value)}
            required
          />
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">
            Forma de pagamento
          </label>
          <select
            value={formaPagamento}
            onChange={(e) => setFormaPagamento(e.target.value as FormaPagamento)}
            className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
          >
            {Object.entries(FORMA_LABEL).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>

        {modo === "individual" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-text-soft">
              Observação (opcional)
            </label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              placeholder="Ex: quitado com desconto, acordo de renegociação..."
              className="rounded-lg border border-line bg-cream px-3 py-2 text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
            />
          </div>
        )}

        {erro && (
          <p role="alert" className="rounded-lg bg-crit-bg px-3 py-2 text-sm font-medium text-crit">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={pendente}
          className="rounded-full bg-gradient-to-br from-gold-start to-gold-end py-2.5 text-sm font-semibold text-gold-ink disabled:opacity-60"
        >
          {pendente ? "Salvando…" : "Confirmar baixa"}
        </button>
      </form>
    </Modal>
  );
}
