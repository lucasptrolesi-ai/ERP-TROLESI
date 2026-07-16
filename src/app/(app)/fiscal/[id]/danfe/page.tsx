import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarMoeda } from "@/lib/formatar-moeda";
import { formatarDataIso } from "@/lib/datas";
import { EMPRESA } from "@/lib/empresa";
import { BotaoImprimir } from "@/components/botao-imprimir";
import { comoLista } from "@/lib/supabase-embed";

type ClienteDanfe = {
  nome: string;
  razao_social: string | null;
  cpf_cnpj: string | null;
  telefone: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
};

type NotaDanfe = {
  id: string;
  pedido_id: string;
  status: string;
  cfop: string;
  natureza_operacao: string;
  serie: string;
  valor_total: number;
  criado_em: string;
  pedidos: { numero: number; criado_em: string; subtotal: number; valor_desconto: number; valor_acrescimo: number } | null;
  clientes: ClienteDanfe | null;
};

type ItemDanfe = {
  quantidade: number;
  preco_unitario: number;
  produtos: { nome: string; codigo_interno: string | null; ncm: string | null; csosn: string } | null;
};

function Campo({ label, valor, className = "" }: { label: string; valor: string; className?: string }) {
  return (
    <div className={`border-r border-ink px-1.5 py-1 last:border-r-0 ${className}`}>
      <p className="text-[6.5px] font-semibold uppercase leading-none text-ink/70">{label}</p>
      <p className="mt-1 truncate text-[10px] leading-none">{valor}</p>
    </div>
  );
}

export default async function DanfePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: notaRaw } = await supabase
    .from("notas_fiscais")
    .select(
      "id, pedido_id, status, cfop, natureza_operacao, serie, valor_total, criado_em, pedidos(numero, criado_em, subtotal, valor_desconto, valor_acrescimo), clientes(nome, razao_social, cpf_cnpj, telefone, endereco, bairro, cidade, uf, cep)",
    )
    .eq("id", id)
    .single();

  if (!notaRaw) notFound();
  const nota = notaRaw as unknown as NotaDanfe;
  const cliente = nota.clientes;
  const pedido = nota.pedidos;

  const { data: itensRaw } = await supabase
    .from("pedido_itens")
    .select("quantidade, preco_unitario, produtos(nome, codigo_interno, ncm, csosn)")
    .eq("pedido_id", nota.pedido_id)
    .order("id");
  const itens = comoLista<ItemDanfe>(itensRaw);

  const dataEmissao = formatarDataIso(pedido?.criado_em ?? nota.criado_em);
  const enderecoEmit = `${EMPRESA.endereco.logradouro}, ${EMPRESA.endereco.numero}`;
  const clienteDoc = cliente?.cpf_cnpj ?? "—";
  const validado = nota.status !== "gerada";

  return (
    <div className="flex flex-col items-center gap-4 py-6 print:gap-0 print:py-0">
      <style>{`@media print { @page { size: A4 portrait; margin: 8mm; } }`}</style>

      <div className="w-full max-w-3xl text-[9px] leading-tight text-ink print:max-w-none">
        {/* Canhoto — recibo de entrega, destacável no papel real */}
        <div className="grid grid-cols-[1fr_130px] border border-ink">
          <div className="flex flex-col justify-between border-r border-ink p-1.5">
            <p className="text-[8px]">
              Recebemos de <strong>{EMPRESA.razaoSocial}</strong> os produtos e/ou serviços constantes da Nota
              Fiscal indicada ao lado. Emissão: {dataEmissao} — Dest/Reme: {cliente?.razao_social || cliente?.nome} —
              Valor Total: {formatarMoeda(nota.valor_total)}
            </p>
            <div className="mt-2 grid grid-cols-[110px_1fr] border-t border-ink pt-1 text-[7px] uppercase text-ink/70">
              <span className="border-r border-ink pr-1">Data do recebimento</span>
              <span className="pl-1">Identificação e assinatura do recebedor</span>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center gap-0.5 p-1.5 text-center">
            <p className="text-[10px] font-bold">NF-e</p>
            <p className="text-[8px]">Pedido #{pedido?.numero ?? "—"} (rascunho)</p>
            <p className="text-[8px]">Série {nota.serie}</p>
          </div>
        </div>
        <div className="my-1.5 border-t border-dashed border-ink/50" />

        <div className="rounded-[10px] border-2 border-warn bg-warn-bg px-2 py-1 text-center text-[9px] font-bold text-warn print:bg-transparent">
          RASCUNHO DE CONFERÊNCIA — NÃO É DOCUMENTO FISCAL VÁLIDO — NADA TRANSMITIDO À SEFAZ
        </div>

        {/* Bloco principal */}
        <div className="mt-1.5 border border-ink">
          <div className="grid grid-cols-[1fr_130px_170px] border-b border-ink">
            <div className="border-r border-ink p-1.5">
              <p className="text-[11px] font-bold">{EMPRESA.nome}</p>
              <p>{EMPRESA.razaoSocial}</p>
              <p>
                {enderecoEmit} — {EMPRESA.endereco.bairro}
              </p>
              <p>
                {EMPRESA.endereco.cidade}/{EMPRESA.endereco.uf} — CEP {EMPRESA.endereco.cep}
              </p>
            </div>
            <div className="flex flex-col items-center justify-center gap-0.5 border-r border-ink p-1.5 text-center">
              <p className="text-[13px] font-bold leading-none">DANFE</p>
              <p className="text-[6.5px] leading-tight">Documento Auxiliar da Nota Fiscal Eletrônica</p>
              <p className="text-[6.5px] leading-tight">0-Entrada / 1-Saída</p>
              <span className="flex h-4 w-4 items-center justify-center border border-ink text-[9px] font-bold">1</span>
              <p className="mt-1 text-[8px]">
                Nº {pedido?.numero ?? "—"} (rascunho) · Série {nota.serie} · Folha 1/1
              </p>
            </div>
            <div className="flex flex-col justify-center gap-1 p-1.5">
              <p className="text-[6.5px] font-semibold uppercase text-ink/70">Chave de acesso</p>
              <p className="rounded border border-ink/50 px-1 py-2 text-center text-[8px] font-semibold">
                PENDENTE — nota em conferência, ainda não autorizada
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1fr] border-b border-ink">
            <Campo label="Natureza da operação" valor={nota.natureza_operacao} />
            <Campo label="Protocolo de autorização de uso" valor="Pendente — nota não emitida" />
          </div>

          <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-ink">
            <Campo label="Inscrição estadual" valor={EMPRESA.inscricaoEstadual} />
            <Campo label="Inscrição estadual do substituto tributário" valor="—" />
            <Campo label="CNPJ / CPF" valor={EMPRESA.cpfCnpj} />
          </div>

          <p className="border-b border-ink bg-cream px-1.5 py-0.5 text-[7px] font-bold uppercase text-ink/70">
            Destinatário / Remetente
          </p>
          <div className="grid grid-cols-[1fr_170px_120px] border-b border-ink">
            <Campo label="Nome / Razão social" valor={cliente?.razao_social || cliente?.nome || "—"} />
            <Campo label="CNPJ / CPF" valor={clienteDoc} />
            <Campo label="Data da emissão" valor={dataEmissao} />
          </div>
          <div className="grid grid-cols-[1fr_140px_100px_120px] border-b border-ink">
            <Campo label="Endereço" valor={cliente?.endereco ?? "—"} />
            <Campo label="Bairro / Distrito" valor={cliente?.bairro ?? "—"} />
            <Campo label="CEP" valor={cliente?.cep ?? "—"} />
            <Campo label="Data da saída" valor={dataEmissao} />
          </div>
          <div className="grid grid-cols-[1fr_60px_140px_140px_100px] border-b border-ink">
            <Campo label="Município" valor={cliente?.cidade ?? "—"} />
            <Campo label="UF" valor={cliente?.uf ?? "—"} />
            <Campo label="Telefone / Fax" valor={cliente?.telefone ?? "—"} />
            <Campo label="Inscrição estadual" valor="—" />
            <Campo label="Hora da saída" valor="—" />
          </div>

          <p className="border-b border-ink bg-cream px-1.5 py-0.5 text-[7px] font-bold uppercase text-ink/70">
            Cálculo do imposto
            <span className="ml-2 normal-case font-normal text-ink/60">
              (ICMS/IPI/frete/seguro não calculados em modo conferência — sempre zerados)
            </span>
          </p>
          <div className="grid grid-cols-5 border-b border-ink">
            <Campo label="Base de cálc. do ICMS" valor={formatarMoeda(0)} />
            <Campo label="Valor do ICMS" valor={formatarMoeda(0)} />
            <Campo label="Base cálc. ICMS subst." valor={formatarMoeda(0)} />
            <Campo label="Valor do ICMS subst." valor={formatarMoeda(0)} />
            <Campo label="Valor total dos produtos" valor={formatarMoeda(pedido?.subtotal ?? nota.valor_total)} />
          </div>
          <div className="grid grid-cols-6 border-b border-ink">
            <Campo label="Valor do frete" valor={formatarMoeda(0)} />
            <Campo label="Valor do seguro" valor={formatarMoeda(0)} />
            <Campo label="Desconto" valor={formatarMoeda(pedido?.valor_desconto ?? 0)} />
            <Campo label="Outras despesas acess." valor={formatarMoeda(pedido?.valor_acrescimo ?? 0)} />
            <Campo label="Valor do IPI" valor={formatarMoeda(0)} />
            <Campo label="Valor total da nota" valor={formatarMoeda(nota.valor_total)} className="font-bold" />
          </div>

          <p className="border-b border-ink bg-cream px-1.5 py-0.5 text-[7px] font-bold uppercase text-ink/70">
            Transportador / Volumes transportados
          </p>
          <div className="border-b border-ink px-1.5 py-1 text-[8px]">9 — Sem frete</div>

          <p className="border-b border-ink bg-cream px-1.5 py-0.5 text-[7px] font-bold uppercase text-ink/70">
            Dados dos produtos / serviços
          </p>
          <table className="w-full border-b border-ink text-[8px]">
            <thead>
              <tr className="border-b border-ink text-left font-bold uppercase">
                <th className="border-r border-ink px-1.5 py-1">Código</th>
                <th className="border-r border-ink px-1.5 py-1">Descrição</th>
                <th className="border-r border-ink px-1.5 py-1">NCM/SH</th>
                <th className="border-r border-ink px-1.5 py-1">CST/CSOSN</th>
                <th className="border-r border-ink px-1.5 py-1">CFOP</th>
                <th className="border-r border-ink px-1.5 py-1">Unid.</th>
                <th className="border-r border-ink px-1.5 py-1 text-right">Qtde.</th>
                <th className="border-r border-ink px-1.5 py-1 text-right">Vl. unitário</th>
                <th className="px-1.5 py-1 text-right">Vl. total</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item, i) => (
                <tr key={i} className="border-t border-ink/30">
                  <td className="border-r border-ink px-1.5 py-1">{item.produtos?.codigo_interno ?? "—"}</td>
                  <td className="border-r border-ink px-1.5 py-1">{item.produtos?.nome ?? "Produto"}</td>
                  <td className="border-r border-ink px-1.5 py-1 tabular-nums">{item.produtos?.ncm ?? "—"}</td>
                  <td className="border-r border-ink px-1.5 py-1 tabular-nums">{item.produtos?.csosn ?? "—"}</td>
                  <td className="border-r border-ink px-1.5 py-1 tabular-nums">{nota.cfop}</td>
                  <td className="border-r border-ink px-1.5 py-1">PC</td>
                  <td className="border-r border-ink px-1.5 py-1 text-right tabular-nums">{item.quantidade}</td>
                  <td className="border-r border-ink px-1.5 py-1 text-right tabular-nums">
                    {formatarMoeda(item.preco_unitario)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {formatarMoeda(item.quantidade * item.preco_unitario)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="bg-cream px-1.5 py-0.5 text-[7px] font-bold uppercase text-ink/70">Dados adicionais</p>
          <div className="grid grid-cols-[1fr_170px]">
            <div className="border-r border-ink p-1.5 text-[8px] text-ink/70">
              Documento gerado pelo ERP Trolesi em modo conferência — {validado ? "validado" : "ainda não validado"}
              , sem valor fiscal.
            </div>
            <div className="p-1.5 text-[8px] text-ink/70">Reservado ao fisco</div>
          </div>
        </div>
      </div>

      <BotaoImprimir />
    </div>
  );
}
