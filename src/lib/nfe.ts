import { EMPRESA } from "@/lib/empresa";

/** produção própria dentro de MG (5101) / fora de MG (6101) — confirmado
 * com o usuário como padrão, batendo com o histórico real do GMax (122 das
 * 172 notas emitidas usam essa faixa de CFOP). Editável por nota depois. */
export function cfopPadrao(clienteUf: string | null): string {
  const dentroDoEstado = !clienteUf || clienteUf.toUpperCase() === EMPRESA.endereco.uf;
  return dentroDoEstado ? "5101" : "6101";
}

export type ItemNfe = {
  nome: string;
  ncm: string | null;
  csosn: string;
  quantidade: number;
  precoUnitario: number;
};

export type DestinatarioNfe = {
  nome: string;
  razaoSocial: string | null;
  cpfCnpj: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
};

export type DadosNfe = {
  numeroPedido: number;
  serie: string;
  naturezaOperacao: string;
  cfop: string;
  dataEmissao: string;
  cliente: DestinatarioNfe;
  itens: ItemNfe[];
  subtotal: number;
  desconto: number;
  acrescimo: number;
  total: number;
};

function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function soDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

// O CSOSN vira parte do NOME da tag (<ICMSSN101>...), não só um valor — se
// vier algo fora do formato esperado (a maioria dos csosn no banco foi
// importada em lote do GMax, sem validação de formato), interpolar direto
// quebraria o XML gerado. Valida antes, cai pro padrão '101' se suspeito.
function csosnSeguro(csosn: string): string {
  return /^\d{2,3}$/.test(csosn) ? csosn : "101";
}

/**
 * Monta um XML no formato geral da NF-e (grupos infNFe/emit/dest/det/total)
 * pra CONFERÊNCIA — não segue o XSD oficial da SEFAZ à risca, não tem
 * assinatura digital, chave de acesso ou protocolo. É pra revisar os dados
 * (produto, NCM, CFOP, valores) antes de decidir como emitir de verdade
 * (via provedor, na Fase 6/7 do projeto) — não é um documento fiscal válido.
 */
export function gerarXmlConferencia(dados: DadosNfe): string {
  const docCliente = soDigitos(dados.cliente.cpfCnpj);
  const tagDoc = docCliente.length > 11 ? "CNPJ" : "CPF";
  const valorDoc = docCliente || "SEM CPF/CNPJ CADASTRADO";

  const itens = dados.itens
    .map((item, i) => {
      const vProd = (item.quantidade * item.precoUnitario).toFixed(2);
      const csosn = csosnSeguro(item.csosn);
      return `    <det nItem="${i + 1}">
      <prod>
        <xProd>${escaparXml(item.nome)}</xProd>
        <NCM>${item.ncm ?? "SEM NCM"}</NCM>
        <CFOP>${dados.cfop}</CFOP>
        <qCom>${item.quantidade.toFixed(4)}</qCom>
        <vUnCom>${item.precoUnitario.toFixed(2)}</vUnCom>
        <vProd>${vProd}</vProd>
      </prod>
      <imposto>
        <ICMS>
          <ICMSSN${csosn}>
            <orig>0</orig>
            <CSOSN>${csosn}</CSOSN>
          </ICMSSN${csosn}>
        </ICMS>
      </imposto>
    </det>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- RASCUNHO DE CONFERÊNCIA — não é um XML de NF-e válido nem assinado -->
<NFe>
  <infNFe>
    <ide>
      <natOp>${escaparXml(dados.naturezaOperacao)}</natOp>
      <serie>${escaparXml(dados.serie)}</serie>
      <nPedido>${dados.numeroPedido}</nPedido>
      <dhEmi>${dados.dataEmissao}</dhEmi>
      <tpNF>1</tpNF>
      <cMunFG>${EMPRESA.endereco.codigoIbgeCidade}</cMunFG>
    </ide>
    <emit>
      <CNPJ>${soDigitos(EMPRESA.cpfCnpj)}</CNPJ>
      <xNome>${escaparXml(EMPRESA.razaoSocial)}</xNome>
      <xFant>${escaparXml(EMPRESA.nome)}</xFant>
      <IE>${EMPRESA.inscricaoEstadual}</IE>
      <CRT>${EMPRESA.crt}</CRT>
      <enderEmit>
        <xLgr>${escaparXml(EMPRESA.endereco.logradouro)}</xLgr>
        <nro>${EMPRESA.endereco.numero}</nro>
        <xBairro>${escaparXml(EMPRESA.endereco.bairro)}</xBairro>
        <xMun>${escaparXml(EMPRESA.endereco.cidade)}</xMun>
        <UF>${EMPRESA.endereco.uf}</UF>
        <CEP>${soDigitos(EMPRESA.endereco.cep)}</CEP>
      </enderEmit>
    </emit>
    <dest>
      <${tagDoc}>${valorDoc}</${tagDoc}>
      <xNome>${escaparXml(dados.cliente.razaoSocial || dados.cliente.nome)}</xNome>
      <enderDest>
        <xLgr>${escaparXml(dados.cliente.endereco ?? "")}</xLgr>
        <xBairro>${escaparXml(dados.cliente.bairro ?? "")}</xBairro>
        <xMun>${escaparXml(dados.cliente.cidade ?? "")}</xMun>
        <UF>${dados.cliente.uf ?? ""}</UF>
        <CEP>${soDigitos(dados.cliente.cep)}</CEP>
      </enderDest>
    </dest>
${itens}
    <total>
      <ICMSTot>
        <vProd>${dados.subtotal.toFixed(2)}</vProd>
        <vDesc>${dados.desconto.toFixed(2)}</vDesc>
        <vOutro>${dados.acrescimo.toFixed(2)}</vOutro>
        <vNF>${dados.total.toFixed(2)}</vNF>
      </ICMSTot>
    </total>
  </infNFe>
</NFe>`;
}
