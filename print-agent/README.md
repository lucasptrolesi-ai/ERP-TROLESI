# Print-agent local — ERP Trolesi

Programinho que roda só neste PC (o mesmo onde a impressora térmica Elgin i8
está instalada) e recebe pedidos de impressão do ERP Trolesi (a página no
navegador) via HTTP, mandando os comandos direto pra impressora em modo
ESC/POS nativo — sem passar pelo desenho/rasterização de página do
navegador, que é o que deixava o cupom saindo borrado numa impressora
térmica.

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

1. Fica escutando em `http://127.0.0.1:41022` (só nessa máquina — o
   endereço `127.0.0.1` não é alcançável de outro computador).
2. O ERP (rodando no navegador, em `https://erp-trolesi.vercel.app`) tenta
   mandar o cupom pra esse endereço primeiro. Se o agente não estiver
   rodando (ou não estiver instalado nessa máquina), a tentativa falha e o
   ERP cai automaticamente pro `window.print()` de sempre — nada quebra.
3. Quando o agente responde, monta os comandos ESC/POS e copia (`copy /b`)
   pro compartilhamento de rede da impressora já configurado no Windows
   (`\\SERVIDOR\ELGIN i8`).

## Permissão do navegador (só na 1ª vez)

Como a página é servida via HTTPS (`erp-trolesi.vercel.app`) e o agente é
`http://127.0.0.1` (endereço "local"), o Chrome/Edge pede permissão explícita
("Acessar dispositivos na rede local") na primeira tentativa de impressão
depois de instalar o agente. Basta permitir uma vez — o navegador lembra
depois disso pra esse site. Se não aparecer nenhum aviso e o cupom continuar
saindo pelo jeito antigo (borrado), verifique em
`chrome://settings/content/all` (ou o equivalente no Edge) se esse site tem
a permissão de rede local bloqueada.

## Instalação (rodar sozinho ao ligar o PC)

Já configurado nesta máquina (SERVIDOR) via atalho na pasta Inicializar do
Windows (`shell:startup`) apontando pro `iniciar_agente_oculto.vbs`, que roda
o `iniciar_agente.bat` sem abrir janela de terminal. Pra reinstalar (ex: em
outro PC de caixa):

1. Copiar a pasta `print-agent/` inteira pro PC de destino.
2. Confirmar que a impressora térmica está instalada e **compartilhada** no
   Windows (Painel de Controle → Dispositivos e Impressoras → botão direito
   na impressora → Propriedades da Impressora → aba Compartilhamento).
   Anotar o nome do compartilhamento.
3. Se o nome do compartilhamento ou o nome da máquina for diferente, ajustar
   via variáveis de ambiente antes de rodar (ou editar direto o `agent.js`):
   - `IMPRESSORA_COMPARTILHAMENTO` (padrão: `ELGIN i8`)
   - `PORTA_PRINT_AGENT` (padrão: `41022`)
4. Criar um atalho pro `iniciar_agente_oculto.vbs` na pasta Inicializar
   (`shell:startup` na caixa Executar do Windows).
5. Testar: `Invoke-RestMethod http://127.0.0.1:41022/status` no PowerShell
   deve devolver `{ ok: true, impressora: "...", maquina: "..." }`.

## Limitações conhecidas

- **Sem acento**: os caracteres acentuados (ç, ã, é...) saem sem acento de
  propósito — o code page correto da impressora pra acentos ainda não foi
  confirmado na prática, e testar errado sai pior (caractere garbled) do que
  simplesmente sem acento. Se quiser tentar habilitar acentos depois, dá pra
  testar o code page (comando ESC/POS `ESC t n`) e ajustar `agent.js`.
- **48 colunas por linha**: confirmado na prática pra Elgin i8 com papel de
  58mm (área útil de 48mm). Se trocar de impressora/papel, meça de novo
  (ver histórico da conversa/`DECISIONS.md` pra o método usado).
- Só funciona nesse PC específico — se a loja tiver mais de um caixa com
  impressora própria, cada PC precisa da sua própria cópia rodando (mesma
  porta, endereços diferentes por ser cada um `127.0.0.1` local).
