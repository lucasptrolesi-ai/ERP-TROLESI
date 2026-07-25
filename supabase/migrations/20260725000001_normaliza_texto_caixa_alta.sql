-- Cadastro em caixa alta (pedido direto do usuário, 2026-07-25): a partir de
-- agora todo texto livre digitado nos formulários é salvo em maiúsculo (ver
-- `normalizarCampo`/`FormField` no código). Esta migration converte pra
-- maiúsculo o que já estava gravado antes dessa mudança, pra não ficar com
-- registro antigo em minúsculo/misto ao lado de registro novo em maiúsculo.
--
-- Só toca coluna de texto livre digitado por gente (nome, endereço,
-- descrição, parecer...). Fica de fora, de propósito:
--   - enum/status/código controlado pelo código (garantia_tipo,
--     origem_mercadoria, cest/cfop_padrao/cst, situacao/status_orient/
--     crediario_status, forma_pagamento_baixa) — mudar o valor quebraria o
--     match exato com a constante que o código espera.
--   - e-mail, URL, CPF/CNPJ, telefone, CEP, id — não faz sentido maiusculizar
--     ou já é validado/normalizado por outro caminho.
--   - `abatimentos.motivo_avaliacao` — texto gerado pelo sistema
--     (`avaliarPecaParaAbatimento`), nunca digitado por ninguém.
--   - `garantias.justificativa` — a mesma coluna guarda tanto justificativa
--     digitada por gente (`decidirGarantia`) quanto texto gerado por
--     `avaliarGarantiaFolheado` (caminho folheado a ouro); como não dá pra
--     distinguir uma linha existente da outra só olhando o valor, fica de
--     fora inteira aqui pra não maiusculizar sentença gerada pelo sistema —
--     só o código (`src/lib/actions/garantias.ts`) já sabe diferenciar as
--     duas daqui pra frente.
--   - `audit_log.justificativa` — decisão deliberada, não esquecimento: é
--     trilha de auditoria (quem aprovou/reprovou o quê e por quê), registro
--     histórico do que foi digitado *na época*; reescrever o passado não
--     faz sentido pra um audit log, mesmo que fique com caixa mista de
--     registro antigo ao lado de novo em maiúsculo dali pra frente.
--
-- ROLLBACK:
-- Não é reversível: maiusculizar destrói a caixa original (não dá pra saber
-- depois se "João" virou "JOÃO" a partir de "joão" ou de "JOÃO" mesmo). Se
-- for realmente necessário desfazer, restaurar a partir de um backup de
-- antes desta migration.

update public.clientes set
  nome = upper(nome),
  cidade = upper(cidade),
  bairro = upper(bairro),
  endereco = upper(endereco),
  razao_social = upper(razao_social),
  nome_fantasia = upper(nome_fantasia),
  situacao_cadastral = upper(situacao_cadastral),
  natureza_juridica = upper(natureza_juridica),
  porte = upper(porte),
  atividade_principal = upper(atividade_principal),
  uf = upper(uf);

update public.fornecedores set
  nome = upper(nome),
  cidade = upper(cidade),
  uf = upper(uf);

update public.produtos set
  nome = upper(nome),
  categoria = upper(categoria),
  subcategoria = upper(subcategoria),
  subsubcategoria = upper(subsubcategoria),
  codigo_interno = upper(codigo_interno),
  codigo_barras = upper(codigo_barras),
  referencia = upper(referencia),
  descricao = upper(descricao),
  material = upper(material),
  tipo_banho = upper(tipo_banho),
  colecao = upper(colecao),
  cor = upper(cor),
  tamanho = upper(tamanho),
  genero = upper(genero);

update public.profiles set
  nome = upper(nome);

update public.abatimentos set
  material = upper(material),
  tipo_peca = upper(tipo_peca),
  estado_descricao = upper(estado_descricao);

update public.garantias set
  parecer = upper(parecer),
  numero_serie = upper(numero_serie),
  partes_faltando = upper(partes_faltando);

update public.crediario_lancamentos set
  recibo_numero = upper(recibo_numero);

update public.expedicoes set
  endereco_entrega = upper(endereco_entrega),
  destinatario = upper(destinatario),
  transportadora = upper(transportadora),
  modalidade = upper(modalidade),
  motivo_frete_gratis = upper(motivo_frete_gratis),
  rastreamento = upper(rastreamento);

update public.contas_pagar set
  descricao = upper(descricao),
  observacao_baixa = upper(observacao_baixa);

update public.contas_receber set
  observacao_baixa = upper(observacao_baixa);

update public.notas_fiscais set
  natureza_operacao = upper(natureza_operacao);
