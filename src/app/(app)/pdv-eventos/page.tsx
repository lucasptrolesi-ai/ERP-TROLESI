import { createClient } from "@/lib/supabase/server";
import { getPerfilAtual } from "@/lib/supabase/auth";
import { podeEditarPedidos } from "@/lib/permissoes";
import { comoLista } from "@/lib/supabase-embed";
import { hojeIso } from "@/lib/datas";
import { PdvEventosView } from "./pdv-eventos-view";
import type { CupomEvento, MovimentoCaixaEvento, ProdutoParaImportar, VendaEvento } from "@/lib/types";

export default async function PdvEventosPage() {
  const perfil = await getPerfilAtual();

  // Mesmos papéis do PDV real (admin/vendedor) — é quem opera venda no
  // balcão/estande. Financeiro/estoque não têm motivo pra mexer aqui, e a
  // RLS de produtos_evento/criar_venda_evento já restringe a escrita do
  // mesmo jeito; a checagem explícita evita a tela "zerada" sem explicação.
  if (!podeEditarPedidos(perfil.papel)) {
    return (
      <div className="rounded-[14px] border border-line bg-surface p-8 text-center text-sm text-text-soft shadow-sm">
        Você não tem permissão para acessar o PDV Eventos. Fale com um admin se precisar de acesso.
      </div>
    );
  }

  const supabase = await createClient();
  const hoje = hojeIso();
  const [
    { data: produtosEvento },
    { data: vendasEvento },
    { data: produtosReais },
    { data: cotacaoOuro },
    { data: cupons },
    { data: movimentos },
    { data: aberturas },
  ] = await Promise.all([
    supabase.from("produtos_evento").select("*").order("criado_em", { ascending: false }),
    supabase
      .from("vendas_evento")
      .select("*, vendas_evento_itens(nome, quantidade, preco_unitario)")
      .eq("status", "faturado")
      .order("criado_em", { ascending: false }),
    // Recorte leve pro modal "Importar do Estoque" — não precisa das ~40
    // colunas comerciais de produtos, só o suficiente pra buscar e conferir
    // estoque disponível.
    supabase
      .from("produtos")
      .select("id, nome, codigo_interno, foto_url, preco, quantidade_estoque, ativo")
      .order("nome"),
    // Mesma cotação diária da tela "Cotação" (material 'Ouro') — usada
    // pela entrada rápida de peça de ouro no estoque do evento.
    supabase.from("cotacoes_diarias").select("valor").eq("material", "Ouro").eq("data", hojeIso()).maybeSingle(),
    supabase.from("cupons_evento").select("*").order("criado_em", { ascending: false }),
    // Todos os movimentos (não só hoje) — mesmo padrão de vendasEvento,
    // filtra por dia dentro do componente (CaixaEvento); volume baixo,
    // evento de poucos dias.
    supabase.from("movimentos_caixa_evento").select("*").order("criado_em", { ascending: true }),
    // Só a abertura de HOJE, a mais recente (se abriu 2x por engano, usa a
    // última) — diferente de movimentos, aqui não tem porque trazer tudo.
    supabase.from("aberturas_caixa_evento").select("valor").eq("data", hoje).order("criado_em", { ascending: false }).limit(1),
  ]);

  return (
    <PdvEventosView
      produtosEvento={produtosEvento ?? []}
      vendasEvento={comoLista<VendaEvento>(vendasEvento)}
      produtosReais={(produtosReais ?? []) as ProdutoParaImportar[]}
      cotacaoOuroHoje={cotacaoOuro?.valor ?? null}
      cupons={(cupons ?? []) as CupomEvento[]}
      movimentos={(movimentos ?? []) as MovimentoCaixaEvento[]}
      valorAberturaHoje={aberturas?.[0]?.valor ?? null}
    />
  );
}
