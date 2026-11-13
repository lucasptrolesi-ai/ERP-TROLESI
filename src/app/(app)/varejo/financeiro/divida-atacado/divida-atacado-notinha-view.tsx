"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BotaoImprimir } from "@/components/botao-imprimir";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { hojeIso, formatarDataIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import { linkWhatsapp } from "@/lib/whatsapp";
import { marcarVariasDividasAtacadoPagas } from "@/lib/actions/varejo-financeiro";
import type { ItemComCodigoAtacado } from "@/lib/relatorios-varejo";

function formatarCodigo(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export function DividaAtacadoNotinhaView({ itens }: { itens: ItemComCodigoAtacado[] }) {
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState("");
  const [pendente, iniciar] = useTransition();
  const [pago, setPago] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const total = itens.reduce((s, i) => s + i.custo_total, 0);
  const mensagemWhatsapp = `Dívida com o Atacado (Trolesi Joias) — ${itens.length} peça(s) em aberto, total ${formatarMoeda(total)}. Segue o comprovante em PDF em anexo.`;

  function marcarTudoPago() {
    setErro(null);
    iniciar(async () => {
      const resultado = await marcarVariasDividasAtacadoPagas(itens.map((i) => i.id));
      if (resultado.erro) setErro(resultado.erro);
      else setPago(true);
    });
  }

  if (itens.length === 0) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Nenhuma dívida com o Atacado em aberto no momento.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6 print:gap-0 print:py-0">
      {/* Mesma impressora térmica 58mm do cupom (pedidos/[id]/cupom) -- a
          loja troca só a bobina entre etiqueta e recibo, a impressora é a
          mesma. Preto puro (não --color-ink da marca): numa térmica
          monocromática, qualquer cor que não seja #000 sai cinza fraco em
          vez de preto sólido. */}
      <style>{`
        @media print {
          @page { size: 58mm auto; margin: 0; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="print:w-[54mm] print:p-[2mm] w-[54mm] rounded border border-line bg-surface p-[2mm] font-sans text-[11px] font-medium leading-snug text-black shadow-sm print:shadow-none">
        <p className="text-center text-[10px] font-bold tracking-wide">PEÇAS EM ABERTO</p>
        <div className="text-center">
          <p className="text-xs font-bold">{EMPRESA.nome}</p>
          <p>CNPJ {EMPRESA.cpfCnpj}</p>
        </div>

        <div className="my-1 border-t border-dashed border-black/50" />

        <p className="text-center font-bold">Dívida com o Atacado</p>
        <p className="text-center">Emitido {formatarDataIso(hojeIso())}</p>

        <div className="my-1 border-t border-dashed border-black/50" />

        <div className="mb-0.5 flex justify-between gap-2 font-bold">
          <span className="flex-1">Qtd Peça / Código</span>
          <span>Valor</span>
        </div>
        {itens.map((i) => (
          <div key={i.id} className="mb-0.5 flex justify-between gap-2">
            <span className="flex-1">
              {i.quantidade}x {i.produto_nome} {formatarCodigo(i.codigo_atacado)}
            </span>
            <span className="tabular-nums">{formatarMoeda(i.custo_total)}</span>
          </div>
        ))}

        <div className="my-1 border-t border-dashed border-black/50" />

        <div className="flex justify-between text-xs font-bold">
          <span>TOTAL EM ABERTO</span>
          <span className="tabular-nums">{formatarMoeda(total)}</span>
        </div>

        <div className="my-1 border-t border-dashed border-black/50" />

        {/* Área em branco pra anotar a quitação na via impressa -- fica
            visível tanto na tela quanto impressa, de propósito (pedido do
            usuário: ter "algum lugar" pra marcar que já foi pago). */}
        <p className="mt-1">Pago em: ___/___/______</p>
        <p className="mt-1">Confirmação: ________________</p>

        <div className="my-1 border-t border-dashed border-black/50" />
        <p className="text-center text-[9px] text-black/70">Documento interno — não fiscal</p>
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-3 print:hidden">
        <BotaoImprimir />

        <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface p-3">
          <p className="text-center text-xs text-text-soft">
            Enviar por WhatsApp — abre a conversa pronta, só falta anexar o PDF (salve pelo botão
            &ldquo;Imprimir&rdquo; acima, escolhendo &ldquo;Salvar como PDF&rdquo;) e enviar.
          </p>
          <input
            value={telefoneWhatsapp}
            onChange={(e) => setTelefoneWhatsapp(e.target.value)}
            placeholder="Telefone (com DDD)"
            className="w-48 rounded-lg border border-line bg-cream px-3 py-1.5 text-center text-sm text-ink outline-none focus:border-rose focus:ring-2 focus:ring-rose-soft"
          />
          <a
            href={telefoneWhatsapp.trim() ? linkWhatsapp(telefoneWhatsapp, mensagemWhatsapp) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!telefoneWhatsapp.trim()}
            onClick={(e) => {
              if (!telefoneWhatsapp.trim()) e.preventDefault();
            }}
            className="rounded-full bg-[#25D366] px-4 py-2 text-xs font-semibold text-white transition aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            📱 Abrir no WhatsApp
          </a>
        </div>

        <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface p-3">
          {pago ? (
            <p className="text-sm font-semibold text-ok">✓ {itens.length} peça(s) marcada(s) como paga(s).</p>
          ) : (
            <>
              <p className="text-center text-xs text-text-soft">
                Depois de pagar o Atacado, marque essas {itens.length} peça(s) como pagas de uma vez
                (fecha exatamente as desta notinha — dívida nova que entrar depois não é afetada).
              </p>
              <button
                type="button"
                onClick={marcarTudoPago}
                disabled={pendente}
                className="rounded-full bg-gradient-to-br from-gold-start to-gold-end px-4 py-2 text-xs font-semibold text-gold-ink disabled:opacity-60"
              >
                {pendente ? "Marcando…" : `✅ Marcar todas como pagas (${itens.length})`}
              </button>
              {erro && <p className="text-xs text-crit">{erro}</p>}
            </>
          )}
        </div>

        <Link href="/varejo/financeiro" className="text-xs font-medium text-text-soft underline">
          ← Voltar pro Controle Financeiro
        </Link>
      </div>
    </div>
  );
}
