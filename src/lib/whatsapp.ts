/** Primeiro nome, capitalizado — nomes ficam salvos em CAIXA ALTA (convenção
 * do sistema), mas "Olá, LUCAS MORAIS..." inteiro em maiúsculo soa como
 * grito numa mensagem de WhatsApp. */
export function primeiroNomeCapitalizado(nomeCompleto: string): string {
  const primeiro = nomeCompleto.trim().split(/\s+/)[0] ?? "";
  return primeiro.charAt(0) + primeiro.slice(1).toLowerCase();
}

/** Link oficial "clique pra conversar" do WhatsApp (wa.me) — abre a conversa
 * já com o texto digitado. Não existe envio automatizado aqui: quem aperta
 * "Enviar" (e anexa o PDF do comprovante) continua sendo uma pessoa de
 * verdade, na sessão de WhatsApp dela — é só um atalho pra não precisar
 * digitar número e mensagem na mão (decisão registrada em DECISIONS.md,
 * 2026-08-12: envio automatizado de verdade arriscaria banir o número da
 * loja). Aceita telefone em qualquer formatação (só dígitos importam) e já
 * assume DDI 55 se não vier incluso. */
export function linkWhatsapp(telefone: string, mensagem: string): string {
  const digitos = telefone.replace(/\D/g, "");
  const comPais = digitos.startsWith("55") && digitos.length >= 12 ? digitos : `55${digitos}`;
  return `https://wa.me/${comPais}?text=${encodeURIComponent(mensagem)}`;
}
