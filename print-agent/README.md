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
3. Ao achar uma pendente, monta os comandos ESC/POS e entrega pra impressora
   de um dos dois jeitos, conforme `MODO_IMPRESSAO_CUPOM` (2026-08-31):
   - `rede` (padrão, Windows/SERVIDOR): copia (`copy /b`) pro compartilhamento
     de rede já configurado (`\\SERVIDOR\ELGIN i8`).
   - `usb` (impressora ligada direto nesta máquina, testado no Mac): escreve
     o buffer direto na porta USB via `usb` (libusb), sem CUPS/driver no
     meio — mesmo espírito do modo rede (bytes crus, sem rasterização).

   Depois marca a linha como `impresso` (ou `erro`, com a mensagem, se algo
   falhar).
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

## Instalação (Windows, modo `rede`)

1. Copiar a pasta `print-agent/` (se ainda não estiver aqui).
2. `cp .env.example .env` e preencher com os valores reais (mesmos do
   `.env.local` do app principal — `NEXT_PUBLIC_SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`, achados em Project Settings → API no
   painel do Supabase). **Nunca commitar o `.env`.**
3. Confirmar que a impressora térmica está instalada e **compartilhada** no
   Windows (Painel de Controle → Dispositivos e Impressoras → botão direito
   na impressora → Propriedades da Impressora → aba Compartilhamento).
   Anotar o nome do compartilhamento e ajustar `IMPRESSORA_COMPARTILHAMENTO`
   no `.env` se for diferente de `ELGIN i8`.
4. Testar manualmente: `node agent.js` — deve logar
   `Print-agent Trolesi ERP rodando — checando solicitações a cada...`.
5. Configurar pra rodar sozinho no login (já feito nesta máquina, SERVIDOR):
   atalho na pasta Inicializar do Windows (`shell:startup`) apontando pro
   `iniciar_agente_oculto.vbs`, que roda o `iniciar_agente.bat` sem abrir
   janela de terminal.

## Instalação (Mac, modo `usb` — testado 2026-08-31)

1. Copiar a pasta `print-agent/` (se ainda não estiver aqui) e rodar
   `npm install` (única dependência: `usb`, tem binário pré-compilado,
   não precisa de nada instalado no sistema).
2. `cp .env.example .env`, preencher `NEXT_PUBLIC_SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY` (mesmo de cima) e definir
   `MODO_IMPRESSAO_CUPOM=usb`.
3. Com a impressora conectada via USB, descobrir o vendor/product ID:
   `ioreg -p IOUSB -l -w 0 | grep -A2 idVendor` (procurar pelo nome da
   impressora perto do resultado). Preencher `IMPRESSORA_CUPOM_VENDOR_ID`
   e `IMPRESSORA_CUPOM_PRODUCT_ID` no `.env` (aceita decimal ou hex
   `0x...`). Elgin i8 testada: vendor `0x1fc9`, product `0x2016`.
4. Testar manualmente: `node agent.js` — deve logar "impressora: USB
   direto, vendor=... product=...".
5. Rodar sozinho no login: criar
   `~/Library/LaunchAgents/com.trolesi.print-agent.plist` apontando pro
   node (caminho completo — launchd não usa o PATH do shell/nvm) e pro
   `agent.js`, com `RunAtLoad`/`KeepAlive` true, saída redirecionada pra
   `print-agent/agente.log` (gitignored). Carregar com
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.trolesi.print-agent.plist`.
   Pra parar/desabilitar: `launchctl bootout gui/$(id -u)/com.trolesi.print-agent`.

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
  mesma solicitação). Com a Elgin i8 movida pro Mac (2026-08-31, modo
  `usb`), o agente do SERVIDOR (Windows, modo `rede`) não deve continuar
  rodando ao mesmo tempo — se um dia ela voltar pro SERVIDOR, desativa o
  LaunchAgent do Mac (`launchctl bootout ...`) antes de religar o do
  Windows. Se a loja crescer pra ter impressora em mais de um caixa, a
  fila precisaria de uma coluna extra (ex: `impressora_id`) pra cada
  agente só pegar as solicitações da sua própria impressora — não
  implementado ainda, não é o caso de uso atual.
- **Comprovante em PDF não sai automaticamente pro WhatsApp** — fica só
  salvo na pasta (`PASTA_COMPROVANTES`, default `Comprovante` na área de
  trabalho), pra você encaminhar manualmente. Decisão deliberada, ver
  `DECISIONS.md` (API oficial do WhatsApp precisa de aprovação/custo por
  mensagem; biblioteca não-oficial arrisca banir o número da loja).
