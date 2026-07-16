// Dados fixos do emitente pros documentos impressos (cupom, promissória) e
// pro XML/DANFE de conferência do módulo Fiscal. Fixo por enquanto —
// quando existir uma tela de configurações da empresa, isso vira dado do
// banco em vez de constante no código.
export const EMPRESA = {
  nome: "TROLESI JOIAS",
  razaoSocial: "JOSE LIBERIO DA SILVA",
  cpfCnpj: "41.832.775/0001-00",
  inscricaoEstadual: "3247950740033",
  // CRT 1 = Simples Nacional (confirmado no cadastro real da empresa no GMax).
  crt: "1",
  endereco: {
    logradouro: "RUA BALDUINO SALGADO",
    numero: "53",
    bairro: "SAO VICENTE",
    cidade: "ITAJUBA",
    uf: "MG",
    cep: "37502084",
    codigoIbgeCidade: "3132404",
  },
};
