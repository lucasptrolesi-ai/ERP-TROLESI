# Print-agent local — ERP Trolesi

Programinho que roda só neste PC (o mesmo onde a impressora térmica Elgin i8
está instalada) e imprime os cupons de venda direto em modo ESC/POS nativo
— sem passar pelo desenho/rasterização de página do navegador, que é o que
deixava o cupom saindo borrado numa impressora térmica.

## Por que existe

Imprimir uma página HTML numa impressora térmica (`window.print()` do
navegador) sai com qualidade ruim: o navegador desenha a página como uma
imagem e a impressora (203dpi, preto-e-branco puro, sem cinza) precisa
converter isso numa trama pontilhada — sempre fica borrado, mesmo com fonte
preta e em negrito. Um sistema nativo (como o GMax) não tem esse problema
porque manda texto direto pro modo nativo da impressora. Este agente faz a
mesma coisa: monta os comandos ESC/POS (negrito, alinhamento, corte) e copia
pro spooler da impressora em modo bruto (RAW), contornando completamente a
rasterização.

## Como funciona

A venda pode ser fechada de **qualquer aparelho da loja** — Mac, Windows,
celular — não só desta máquina. Por isso o agente não espera o navegador
chamá-lo direto (um fetch pro `127.0.0.1` só alcançaria essa mesma máquina);
em vez disso:

1. O ERP (rodando em qualquer navegador) grava o conteúdo do cupom numa
   tabela do Supabase (`solicitacoes_impressao`, status `pendente`).
2. Este agente fica checando essa tabela a cada ~2s (`INTERVALO_POLLING_MS`).
3. Ao achar uma pendente, monta os comandos ESC/POS e copia (`copy /b`) pro
   compartilhamento de rede da impressora já configurado no Windows
   (`\\SERVIDOR\ELGIN i8`), depois marca a linha como `impresso` (ou `erro`,
   com a mensagem, se algo falhar).
4. O navegador que pediu a impressão fica de olho nessa mesma linha
   (polling também, do lado do app) e segue o fluxo (pergunta via cliente,
   etc.) assim que vê `impresso`. Se não confirmar em ~15s, mostra um aviso
   com opção de tentar de novo ou imprimir pela própria página (último
   recurso, não necessariamente na térmica).

## Comprovante em PDF (2026-07-25)

Além de imprimir, o agente salva o mesmo conteúdo do cupom em PDF numa
pasta organizada — pra você encaminhar manualmente pro cliente via
WhatsApp (decisão do usuário: nada de integração automática com WhatsApp,
risco demais de banir o número da loja — ver `DECISIONS.md`).

- Só na via "loja" (sempre exatamente 1x por venda — a via "cliente" é
  opcional/pode repetir, geraria comprovante duplicado à toa).
- Salvo em `PASTA_COMPROVANTES/<ano>/<mes>/Nome do Cliente - DD-MM.pdf`
  (data = `pedidos.criado_em` convertido pra horário de Brasília, não a
  data UTC). Dois clientes com o mesmo nome no mesmo dia (ex: vários
  "CONSUMIDOR") ganham " (2)", " (3)"... no nome — nunca sobrescreve.
- Gerado sem nenhuma dependência de npm (mesmo espírito do resto do
  agente) — o PDF é montado byte a byte, reaproveitando o mesmo cálculo de
  alinhamento de coluna do cupom térmico (`formatarColunas`). Fonte
  Courier (uma das 14 "standard fonts" que todo leitor de PDF já tem
  embutida), com acento correto (diferente do cupom térmico, que ainda
  tira acento por segurança — ver limitação abaixo).
- Independente da impressão física: se a impressora estiver offline, o
  comprovante ainda é salvo (e vice-versa) — são duas preocupações
  separadas no código.

Só existe UM agente rodando (nesta máquina, onde a impressora está
fisicamente ligada) — não precisa (nem deve) rodar em cada computador da
loja.

## Etiqueta de código de barras — PDV Eventos (2026-08-14)

O mesmo agente também imprime etiqueta pequena (21mm × 7mm) na impressora
Argox OS-214TT, usada no módulo PDV Eventos (cadastro de estoque de
evento). Mesma lógica de fila/polling do cupom, tabela separada
(`solicitacoes_etiqueta`), mas o caminho de impressão é bem diferente:

1. O driver Windows oficial da Argox (Seagull) precisa estar instalado e
   **calibrado** — tamanho de papel de etiqueta (21×7mm + gap) e o
   deslocamento de posição ajustados nas Preferências de impressão da
   impressora (feito manualmente uma vez, ver DECISIONS.md 2026-08-14).
   Sem isso calibrado, a etiqueta sai cortada/deslocada não importa o que
   o agente mande.
2. O agente gera um PNG do código de barras (`bwip-js`), monta um PDF do
   tamanho exato da etiqueta em cima dele (`pdfkit`), e manda esse PDF pro
   nome exato da impressora (`pdf-to-printer`, usa o SumatraPDF por baixo)
   — isso passa pelo driver já calibrado, ao contrário do cupom térmico
   que manda bytes crus direto pro spooler.
3. Diferente do resto do agente (zero dependência de npm de propósito),
   essa parte usa 3 pacotes — **rode `npm install` uma vez nesta pasta**
   antes de reiniciar o agente. Se esquecer, o agente ainda sobe e o
   **cupom térmico continua funcionando normalmente** — só a etiqueta fica
   desativada até instalar (aviso claro no console avisa isso).
4. Confirme o nome exato da impressora em Painel de Controle → Dispositivos
   e Impressoras e ajuste `IMPRESSORA_ETIQUETA` no `.env` se for diferente
   de `Argox OS-214TT PPLA`.

## Instalação

1. Copiar a pasta `print-agent/` (se ainda não estiver aqui).
2. `npm install` (só precisa pra etiqueta — o cupom térmico funciona sem
   isso, mas não custa rodar sempre).
3. `cp .env.example .env` e preencher com os valores reais (mesmos do
   `.env.local` do app principal — `NEXT_PUBLIC_SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`, achados em Project Settings → API no
   painel do Supabase). **Nunca commitar o `.env`.**
4. Confirmar que a impressora térmica está instalada e **compartilhada** no
   Windows (Painel de Controle → Dispositivos e Impressoras → botão direito
   na impressora → Propriedades da Impressora → aba Compartilhamento).
   Anotar o nome do compartilhamento e ajustar `IMPRESSORA_COMPARTILHAMENTO`
   no `.env` se for diferente de `ELGIN i8`.
5. Testar manualmente: `node agent.js` — deve logar
   `Print-agent Trolesi ERP rodando — checando solicitações a cada...`.
6. Configurar pra rodar sozinho no login (já feito nesta máquina, SERVIDOR):
   atalho na pasta Inicializar do Windows (`shell:startup`) apontando pro
   `iniciar_agente_oculto.vbs`, que roda o `iniciar_agente.bat` sem abrir
   janela de terminal.

## Limitações conhecidas

- **Sem acento**: os caracteres acentuados (ç, ã, é...) saem sem acento de
  propósito — o code page correto da impressora pra acentos ainda não foi
  confirmado na prática, e testar errado sai pior (caractere garbled) do que
  simplesmente sem acento. Se quiser tentar habilitar acentos depois, dá pra
  testar o code page (comando ESC/POS `ESC t n`) e ajustar `agent.js`.
- **48 colunas por linha**: confirmado na prática pra Elgin i8 com papel de
  58mm (área útil de 48mm). Se trocar de impressora/papel, meça de novo.
- **Um atraso de 2-15s antes de imprimir**: por causa do polling (o agente
  só checa a cada ~2s, e o navegador espera até ~15s por uma confirmação).
  Não é instantâneo como seria um fetch direto, mas funciona de qualquer
  aparelho da loja.
- Só um agente deve rodar por vez (senão duas máquinas tentariam imprimir a
  mesma solicitação). Se a loja crescer pra ter impressora em mais de um
  caixa, a fila precisaria de uma coluna extra (ex: `impressora_id`) pra
  cada agente só pegar as solicitações da sua própria impressora — não
  implementado ainda, não é o caso de uso atual.
- **Comprovante em PDF não sai automaticamente pro WhatsApp** — fica só
  salvo na pasta (`PASTA_COMPROVANTES`, default `Comprovante` na área de
  trabalho), pra você encaminhar manualmente. Decisão deliberada, ver
  `DECISIONS.md` (API oficial do WhatsApp precisa de aprovação/custo por
  mensagem; biblioteca não-oficial arrisca banir o número da loja).
