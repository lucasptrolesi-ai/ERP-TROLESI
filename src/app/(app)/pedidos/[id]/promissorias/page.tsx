import { notFound } from "next/navigation";
import { buscarPedidoDetalhe } from "@/lib/buscar-pedido-detalhe";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { dataPorExtenso, valorPorExtenso } from "@/lib/extenso";
import { EMPRESA } from "@/lib/empresa";
import { BotaoImprimir } from "@/components/botao-imprimir";

export default async function PromissoriasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detalhe = await buscarPedidoDetalhe(id);
  if (!detalhe) notFound();
  const { pedido, parcelas } = detalhe;

  // "cancelado" checado explicitamente mesmo que extornar_pedido já limpe
  // parcelas_planejadas — defesa em profundidade contra reimprimir nota
  // promissória de uma venda cancelada se algum caminho futuro esquecer de
  // limpar esse campo (achado real do code-review, 2026-07-21).
  if (pedido.forma_pagamento !== "promissoria" || parcelas.length === 0 || pedido.status === "cancelado") {
    notFound();
  }

  const cliente = pedido.clientes;
  const endereco = cliente
    ? [cliente.endereco, cliente.bairro, [cliente.cidade, cliente.uf].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" - ")
    : "";
  const dataEmissao = pedido.criado_em.slice(0, 10);

  return (
    <div className="flex flex-col items-center gap-4 py-6 print:gap-0 print:py-0">
      <div className="flex w-full max-w-3xl flex-col gap-4 print:max-w-none print:gap-0">
        {parcelas.map((parcela) => (
          <div
            key={parcela.id}
            className="grid grid-cols-[70px_1fr] border-2 border-ink text-[11px] leading-snug text-ink print:break-inside-avoid"
          >
            <div className="col-span-2 border-b-2 border-ink py-1 text-center text-xs font-bold">
              República Federativa do Brasil — Nota Promissória
            </div>

            <div className="flex flex-col justify-between border-r-2 border-ink p-1">
              <span className="text-[9px] font-semibold">Avalistas</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="mt-2 border-t border-ink/50 pt-0.5 text-[8px]">
                  CPF/CNPJ
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1 p-2">
              <div className="flex items-center justify-between">
                <span>
                  Nº{" "}
                  <strong>
                    {pedido.numero}-{parcela.numero_parcela}/{parcela.total_parcelas}
                  </strong>
                </span>
                <span>
                  Vencimento: <strong>{dataPorExtenso(parcela.vencimento)}</strong>
                </span>
                <span>
                  R$ <strong>{formatarMoeda(parcela.valor).replace("R$", "").trim()}</strong>
                </span>
              </div>

              <p>
                No dia {dataPorExtenso(parcela.vencimento)} pagarei por esta única via de Promissória
                a:
              </p>
              <div className="flex items-baseline justify-between">
                <strong>{EMPRESA.nome}</strong>
                <span>CPF/CNPJ: {EMPRESA.cpfCnpj}</span>
              </div>

              <div className="border border-ink px-2 py-1 text-center text-[10px] font-semibold">
                {valorPorExtenso(parcela.valor)} — em moeda corrente deste país
              </div>

              <div className="flex justify-between">
                <span>Local de pagamento: ______________________</span>
                <span>Data de Emissão: {dataPorExtenso(dataEmissao)}</span>
              </div>

              <div>
                <span>Nome do Emitente: </span>
                <strong>{cliente?.nome ?? "—"}</strong>
              </div>
              <div className="flex flex-wrap gap-x-4">
                <span>CPF/CNPJ: {cliente?.cpf_cnpj ?? "—"}</span>
                <span>Endereço: {endereco || "—"}</span>
              </div>

              <div className="mt-2 self-end border-t border-ink pt-0.5 text-center text-[9px]">
                Assinatura
              </div>
            </div>
          </div>
        ))}
      </div>

      <BotaoImprimir />
    </div>
  );
}
