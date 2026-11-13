import type { ItemComCodigoAtacado } from "@/lib/relatorios-varejo";

// Forma crua da query contra varejo_dividas_atacado (antes de achatar/resolver
// o nome da peça) -- usada tanto em /varejo/relatorios quanto na notinha de
// /varejo/financeiro/divida-atacado, por isso compartilhada aqui em vez de
// duplicada nos dois page.tsx. O cliente supabase-js às vezes devolve essas
// relações to-one como array de 1 em vez de objeto direto, então os dois
// formatos têm que ser aceitos.
export type DividaBruta = {
  id: string;
  codigo_atacado: number;
  quantidade: number;
  custo_total: number;
  venda_itens: { venda_id: string; descricao_manual: string | null } | { venda_id: string; descricao_manual: string | null }[] | null;
  catalogo_variacoes: { catalogo_produtos: { nome: string } | { nome: string }[] | null } | { catalogo_produtos: { nome: string } | { nome: string }[] | null }[] | null;
};

function primeiro<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor;
}

/** Achata a resposta crua do Supabase pra ItemComCodigoAtacado, resolvendo o
 * nome da peça (catálogo) ou a descrição digitada (item manual fora do
 * catálogo) -- mesma resolução que financeiro/page.tsx já fazia na mão pro
 * tipo DividaAtacadoVarejo (mantida separada ali por já ter seu próprio
 * formato de exibição, com SKU/situação/data). */
export function mapearItensAtacado(bruto: DividaBruta[]): ItemComCodigoAtacado[] {
  return bruto.map((d) => {
    const vendaItem = primeiro(d.venda_itens);
    const variacao = primeiro(d.catalogo_variacoes);
    const produto = variacao ? primeiro(variacao.catalogo_produtos) : null;
    return {
      id: d.id,
      produto_nome: produto?.nome ?? vendaItem?.descricao_manual ?? "(item removido)",
      codigo_atacado: d.codigo_atacado,
      quantidade: d.quantidade,
      custo_total: d.custo_total,
      venda_id: vendaItem?.venda_id ?? null,
    };
  });
}
