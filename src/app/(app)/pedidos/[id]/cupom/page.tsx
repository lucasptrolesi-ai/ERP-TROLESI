import { notFound } from "next/navigation";
import { buscarPedidoDetalhe } from "@/lib/buscar-pedido-detalhe";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { FORMA_LABEL } from "@/lib/forma-pagamento";
import { EMPRESA } from "@/lib/empresa";
import { BotaoImprimir } from "@/components/botao-imprimir";

export default async function CupomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detalhe = await buscarPedidoDetalhe(id);
  if (!detalhe) notFound();
  const { pedido, parcelas } = detalhe;

  return (
    <div className="flex flex-col items-center gap-4 py-6 print:gap-0 print:py-0">
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 0; }
        }
      `}</style>

      <div className="print:w-[76mm] print:p-[2mm] w-[76mm] rounded border border-line bg-surface p-[2mm] font-mono text-[11px] leading-snug text-ink shadow-sm print:shadow-none">
        <div className="text-center">
          <p className="text-sm font-bold">{EMPRESA.nome}</p>
          <p>CNPJ {EMPRESA.cpfCnpj}</p>
        </div>
        <div className="my-1 border-t border-dashed border-ink/40" />

        <p>Pedido #{pedido.numero}</p>
        <p>{new Date(pedido.criado_em).toLocaleString("pt-BR")}</p>
        <p>Cliente: {pedido.clientes?.nome ?? "—"}</p>

        <div className="my-1 border-t border-dashed border-ink/40" />

        {pedido.pedido_itens.map((item, i) => (
          <div key={i} className="mb-0.5 flex justify-between gap-2">
            <span className="flex-1">
              {item.quantidade}x {item.produtos?.nome ?? "Produto"}
            </span>
            <span className="tabular-nums">{formatarMoeda(item.quantidade * item.preco_unitario)}</span>
          </div>
        ))}

        <div className="my-1 border-t border-dashed border-ink/40" />

        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatarMoeda(pedido.subtotal)}</span>
        </div>
        {pedido.valor_desconto > 0 && (
          <div className="flex justify-between">
            <span>Desconto</span>
            <span className="tabular-nums">− {formatarMoeda(pedido.valor_desconto)}</span>
          </div>
        )}
        {pedido.valor_acrescimo > 0 && (
          <div className="flex justify-between">
            <span>Acréscimo</span>
            <span className="tabular-nums">+ {formatarMoeda(pedido.valor_acrescimo)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span className="tabular-nums">{formatarMoeda(pedido.total)}</span>
        </div>

        <div className="my-1 border-t border-dashed border-ink/40" />

        <p>Pagamento: {pedido.forma_pagamento ? FORMA_LABEL[pedido.forma_pagamento] : "—"}</p>
        {parcelas.length > 0 &&
          parcelas.map((p) => (
            <p key={p.id}>
              Parcela {p.numero_parcela}/{p.total_parcelas} — vence{" "}
              {new Date(`${p.vencimento}T00:00:00`).toLocaleDateString("pt-BR")} —{" "}
              {formatarMoeda(p.valor)}
            </p>
          ))}

        <div className="my-1 border-t border-dashed border-ink/40" />
        <p className="text-center">Obrigado pela preferência!</p>
      </div>

      <BotaoImprimir />
    </div>
  );
}
