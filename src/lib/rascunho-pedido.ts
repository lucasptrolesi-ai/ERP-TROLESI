// Chave usada pelo formulário de novo pedido (PDV) pra não perder a venda em
// andamento ao navegar pra Estoque/Cadastros e voltar — ver novo-pedido.tsx.
// Exportada aqui (não só em novo-pedido.tsx) porque o logout (app-shell.tsx)
// também precisa limpá-la, evitando que o rascunho de um operador vaze pro
// próximo que logar no mesmo terminal.
export const CHAVE_RASCUNHO_PEDIDO = "trolesi-erp:pdv-rascunho";
