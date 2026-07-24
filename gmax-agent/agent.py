# -*- coding: utf-8 -*-
# Agente local de importação GMax -> Trolesi ERP. Roda na mesma máquina do
# print-agent (SERVIDOR) — a mesma máquina onde `GMaxERP.FDB` já mora
# localmente (C:\GMax\GMaxERP.FDB), sem precisar de compartilhamento de
# rede nenhum.
#
# Por que existe: o Trolesi ERP roda na nuvem (Vercel) e não enxerga o
# arquivo/rede da loja — mesma classe de problema já resolvida pro cupom
# térmico (ver print-agent/). Em vez de imprimir, este agente lê o Firebird
# (nunca o arquivo ao vivo, sempre uma cópia — mesma regra do resto do
# projeto) e escreve um relatório resolvido de volta pro Supabase; quem
# realmente GRAVA os pedidos é o Next.js (função SQL
# `importar_pedidos_gmax`, chamada só depois que um admin confirma a
# prévia na tela). O agente nunca grava pedido/cliente/estoque direto — só
# lê GMax e Trolesi, resolve o que der, e relata.
#
# Zero dependências além de `fdb` (only pip install necessário) — resto é
# só biblioteca padrão do Python, mesmo espírito do print-agent (zero deps
# de npm) de não exigir instalação complicada numa loja.
import json
import os
import shutil
import sys
import time
import traceback
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

# Janela rolante de dias considerada "recente" pra efeito de importação — ver
# comentário em buscar_pedidos_novos_gmax. 30 dias cobre com folga o caso de
# uso real ("esqueci de lançar no Trolesi por um tempo"), sem reabrir meses
# de atividade antiga do GMax a cada busca.
JANELA_DIAS = 30

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapeamento_pagamento import MAPA_FORMA_PAGAMENTO, STATUS_IMPORTAVEIS  # noqa: E402

PASTA_AGENTE = os.path.dirname(os.path.abspath(__file__))


def carregar_env_local():
    """Carrega gmax-agent/.env manualmente (sem depender de python-dotenv,
    mesmo espírito do print-agent de minimizar dependências externas). Só
    preenche variáveis que ainda não existem no ambiente."""
    caminho_env = os.path.join(PASTA_AGENTE, ".env")
    if not os.path.exists(caminho_env):
        return
    with open(caminho_env, "r", encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            chave, valor = chave.strip(), valor.strip()
            if chave not in os.environ:
                os.environ[chave] = valor


carregar_env_local()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
CAMINHO_GMAX_FDB = os.environ.get("CAMINHO_GMAX_FDB", r"C:\GMax\GMaxERP.FDB")
CAMINHO_FBEMBED = os.environ.get("CAMINHO_FBEMBED", os.path.join(PASTA_AGENTE, "fbembed", "fbembed.dll"))
INTERVALO_POLLING_MS = int(os.environ.get("INTERVALO_POLLING_MS", "5000"))

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print(
        "Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — "
        "crie um arquivo gmax-agent/.env (ver README.md)."
    )
    sys.exit(1)


def requisicao_supabase(caminho, metodo="GET", corpo_objeto=None):
    """Chamada genérica pra API REST (PostgREST) do Supabase, autenticada
    com a service_role key — mesmo padrão já usado no print-agent e no
    resto do projeto pra ações administrativas server-side."""
    url = f"{SUPABASE_URL}/rest/v1{caminho}"
    corpo = json.dumps(corpo_objeto).encode("utf-8") if corpo_objeto is not None else None
    cabecalhos = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if metodo == "PATCH":
        cabecalhos["Prefer"] = "return=minimal"
    elif metodo == "POST":
        # PostgREST não devolve a linha criada por padrão — precisamos do
        # id de volta (ex: produto novo criado por criar_produto).
        cabecalhos["Prefer"] = "return=representation"
    req = urllib.request.Request(url, data=corpo, headers=cabecalhos, method=metodo)
    try:
        with urllib.request.urlopen(req) as resp:
            corpo_resposta = resp.read()
            return json.loads(corpo_resposta) if corpo_resposta else None
    except urllib.error.HTTPError as e:
        raise Exception(f"Supabase respondeu {e.code}: {e.read().decode('utf-8', 'replace')}")


def buscar_pendentes():
    return requisicao_supabase(
        "/solicitacoes_importacao_gmax?status=eq.pendente&order=criado_em.asc&limit=1&select=id"
    )


def marcar_status(solicitacao_id, status, **campos):
    corpo = {"status": status, **campos}
    requisicao_supabase(f"/solicitacoes_importacao_gmax?id=eq.{solicitacao_id}", "PATCH", corpo)


def copiar_fdb():
    """Nunca lê o arquivo ao vivo — sempre uma cópia nova, timestampada
    (mesma regra já seguida manualmente em 2026-07-23, ver DECISIONS.md)."""
    if not os.path.exists(CAMINHO_GMAX_FDB):
        raise Exception(f"Não encontrei o arquivo do GMax em {CAMINHO_GMAX_FDB}.")
    destino = os.path.join(
        PASTA_AGENTE, f"_copia_temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}.fdb"
    )
    shutil.copy2(CAMINHO_GMAX_FDB, destino)
    return destino


def conectar_firebird(caminho_copia):
    import fdb

    fdb.load_api(CAMINHO_FBEMBED)
    return fdb.connect(dsn=caminho_copia, user="SYSDBA", password="masterkey")


def buscar_pedidos_novos_gmax(con, ids_ja_importados):
    # ORCAMENTO_PEDIDO_VENDA_CAB.STATUS_PEDIDO já guarda a sigla (texto,
    # ex: 'R') diretamente — não é uma FK numérica pra tabela STATUS_PEDIDO
    # (achado testando contra dados reais: um join por id causava erro de
    # conversão, já que a coluna é sempre texto).
    cur = con.cursor()
    # Só considera vendas recentes (janela rolante) — achado real testando
    # em produção: sem esse corte, o agente tenta reprocessar TODO o
    # histórico do GMax (anos de pedidos) toda vez que o botão é clicado,
    # porque vendas já importadas antes de este recurso existir (a
    # importação original da Fase 5, via CSV, e a reconciliação manual de
    # 2026-07-23) nunca tiveram `gmax_pedido_id` preenchido. Isso travava o
    # lote inteiro em pedidos antigos com dado incompleto (sem item) ou
    # produto nunca cadastrado (ex: "RELÓGIO", vendido só uma vez em 2020) —
    # o botão ficaria bloqueado pra sempre. Uma janela de 90 dias cobre com
    # folga qualquer "esqueci de lançar" sem reabrir histórico irrelevante.
    cur.execute(
        """
        select c.id, c.nome, c.cpf_cnpj, c.id_condicoes_pagamento, c.id_vendedor
        from ORCAMENTO_PEDIDO_VENDA_CAB c
        where c.status_pedido in ({})
          and c.data_cadastro >= ?
        order by c.id
        """.format(",".join(f"'{s}'" for s in STATUS_IMPORTAVEIS)),
        (date.today() - timedelta(days=JANELA_DIAS),),
    )
    pedidos = []
    for row in cur.fetchall():
        gmax_id = row[0]
        if gmax_id in ids_ja_importados:
            continue
        pedidos.append(
            {
                "gmax_id": gmax_id,
                "nome": (row[1] or "").strip(),
                "cpf_cnpj": (row[2] or "").strip(),
                "id_condicoes_pagamento": row[3],
                "id_vendedor": row[4],
            }
        )
    return pedidos


def buscar_itens_gmax(con, gmax_id):
    cur = con.cursor()
    cur.execute(
        """
        select descricao, quantidade, valor_total
        from ORCAMENTO_PEDIDO_VENDA_DET
        where id_orcamento_venda_cabecalho = ?
        order by numero_item
        """,
        (gmax_id,),
    )
    return [
        {"nome": (row[0] or "").strip(), "quantidade": int(row[1]), "valor_total": float(row[2])}
        for row in cur.fetchall()
    ]


def buscar_parcelas_gmax(con, gmax_id):
    cur = con.cursor()
    cur.execute(
        """
        select p.valor, p.data_vencimento
        from LANCAMENTO_RECEBER l
        join PARCELA_RECEBER p on p.id_lancamento_receber = l.id
        where l.id_venda_cabecalho = ?
        order by p.numero_parcela
        """,
        (gmax_id,),
    )
    return [
        {"valor": float(row[0]), "vencimento": row[1].isoformat()}
        for row in cur.fetchall()
    ]


def buscar_nome_vendedor_gmax(con, id_vendedor):
    if id_vendedor is None:
        return None
    cur = con.cursor()
    cur.execute("select nome from VENDEDOR where id = ?", (id_vendedor,))
    row = cur.fetchone()
    return (row[0] or "").strip() if row else None


def resolver_cliente(cpf_cnpj):
    if not cpf_cnpj:
        return None
    resultado = requisicao_supabase(
        f"/clientes?cpf_cnpj=eq.{urllib.parse.quote(cpf_cnpj)}&select=id"
    )
    return resultado[0]["id"] if resultado else None


def normalizar(texto):
    """Maiúsculo, sem acento — pra comparar nome de produto sem falso
    negativo por causa de acentuação. Achado real (2026-07-24): "RELÓGIO"
    do GMax não batia com "RELOGIO" já cadastrado no Trolesi por causa só
    do acento, e quase virou um produto duplicado criado à toa."""
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return sem_acento.strip().upper()


# Categoria inferida por palavra-chave no nome — mesmo padrão "best-effort,
# revisável depois pela tela de Estoque" já usado na importação histórica
# da Fase 5 (migracao-dados/importar_dados_reais.py), reaproveitado aqui
# pra produto novo criado automaticamente. Ordem importa: primeira palavra
# que bater vence.
CATEGORIA_PALAVRAS = [
    ("ALIANCA", "Alianças"),
    ("ANEL", "Anéis"),
    ("BRINCO", "Brincos"),
    ("CORRENTE", "Correntes"),
    ("PULSEIRA", "Pulseiras"),
    ("PINGENTE", "Pingentes"),
    ("TORNOZELEIRA", "Tornozeleiras"),
    ("RELOGIO", "Relógios"),
]


def inferir_categoria(nome):
    nome_normalizado = normalizar(nome)
    for palavra, categoria in CATEGORIA_PALAVRAS:
        if palavra in nome_normalizado:
            return categoria
    return "Diversos"


def buscar_produtos_ativos():
    """Busca o catálogo ativo inteiro uma vez por solicitação (não por
    item) — o catálogo real tem ~50 produtos, uma única chamada é mais
    barata e mais correta que uma busca exata por nome por item (que não
    pega variação de acento)."""
    resultado = requisicao_supabase("/produtos?ativo=eq.true&select=id,nome") or []
    return {normalizar(p["nome"]): p["id"] for p in resultado}


def criar_produto(nome):
    categoria = inferir_categoria(nome)
    resultado = requisicao_supabase(
        "/produtos",
        "POST",
        {
            "nome": nome,
            "categoria": categoria,
            "codigo_peca": 0,
            "multiplicador": 2.8,
            "ativo": True,
        },
    )
    print(f'Produto novo criado: "{nome}" (categoria "{categoria}").')
    return resultado[0]["id"]


def resolver_ou_criar_produto(nome, cache_produtos):
    """cache_produtos é o dict {nome_normalizado: id} de buscar_produtos_ativos(),
    atualizado in-place — garante que dois itens com o mesmo nome novo no
    mesmo lote (ex: duas vendas do mesmo produto novo) não criam duas linhas
    duplicadas em produtos."""
    chave = normalizar(nome)
    if chave in cache_produtos:
        return cache_produtos[chave]
    produto_id = criar_produto(nome)
    cache_produtos[chave] = produto_id
    return produto_id


def resolver_vendedor(nome_gmax):
    if not nome_gmax:
        return None
    resultado = requisicao_supabase(
        f"/profiles?nome=ilike.*{urllib.parse.quote(nome_gmax)}*&select=id&limit=1"
    )
    return resultado[0]["id"] if resultado else None


def processar_solicitacao(solicitacao_id):
    caminho_copia = copiar_fdb()
    try:
        con = conectar_firebird(caminho_copia)
        try:
            ja_importados_raw = requisicao_supabase(
                "/pedidos?gmax_pedido_id=not.is.null&select=gmax_pedido_id"
            )
            ids_ja_importados = {r["gmax_pedido_id"] for r in (ja_importados_raw or [])}

            pedidos_gmax = buscar_pedidos_novos_gmax(con, ids_ja_importados)
            cache_produtos = buscar_produtos_ativos()

            # Nada aqui bloqueia o lote mais (decisão do usuário, 2026-07-24,
            # revendo a escolha original de bloquear produto/forma de
            # pagamento não resolvidos): cliente novo, produto novo e forma
            # de pagamento nunca mapeada são todos resolvidos automaticamente
            # — só um erro genuinamente inesperado (falha de rede, banco
            # fora do ar) usa o status "erro" em vez de "pronto_para_revisao".
            pedidos_resolvidos = []

            for pedido in pedidos_gmax:
                gmax_id = pedido["gmax_id"]
                forma_pagamento = MAPA_FORMA_PAGAMENTO.get(pedido["id_condicoes_pagamento"])
                if forma_pagamento is None:
                    # Só 3 condições do GMax nunca usadas na prática caem
                    # aqui (LIVRE/DEVOLUCAO/CREDITO DA CASA, 0 ocorrências no
                    # histórico real) — "dinheiro" como fallback neutro em
                    # vez de travar a importação por causa de uma condição
                    # que talvez nunca apareça de verdade numa venda.
                    print(
                        f"Pedido GMax #{gmax_id}: condição de pagamento "
                        f"#{pedido['id_condicoes_pagamento']} não mapeada — usando \"dinheiro\"."
                    )
                    forma_pagamento = "dinheiro"

                itens_gmax = buscar_itens_gmax(con, gmax_id)
                if not itens_gmax:
                    # Pedido sem nenhuma linha de detalhe é dado corrompido
                    # do GMax (não uma venda real) — não tem "correção"
                    # possível, então só ignora em vez de tratar como algo
                    # pra resolver.
                    print(f"Pedido GMax #{gmax_id} sem nenhum item — ignorado (não é uma venda real).")
                    continue

                itens_resolvidos = []
                for item in itens_gmax:
                    produto_id = resolver_ou_criar_produto(item["nome"], cache_produtos)
                    # quantidade sempre 1 na prática (cada peça é única, o
                    # preço é que varia por linha) — mesmo padrão observado
                    # na reconciliação manual de 2026-07-23.
                    preco_unitario = item["valor_total"] / item["quantidade"] if item["quantidade"] else item["valor_total"]
                    itens_resolvidos.append(
                        {
                            "produto_id": produto_id,
                            "nome": item["nome"],
                            "quantidade": item["quantidade"],
                            "preco_unitario": round(preco_unitario, 2),
                        }
                    )

                cliente_id = resolver_cliente(pedido["cpf_cnpj"])
                nome_vendedor_gmax = buscar_nome_vendedor_gmax(con, pedido["id_vendedor"])
                vendedor_id = resolver_vendedor(nome_vendedor_gmax)
                parcelas = buscar_parcelas_gmax(con, gmax_id)

                pedidos_resolvidos.append(
                    {
                        "gmax_pedido_id": gmax_id,
                        "forma_pagamento": forma_pagamento,
                        "vendedor_id": vendedor_id,
                        "cliente": {
                            "id": cliente_id,
                            "nome": pedido["nome"],
                            # None (não "") quando vazio — duas vendas sem
                            # CPF no mesmo lote não podem casar uma com a
                            # outra por "string vazia == string vazia"
                            # (achado da revisão; a function SQL também
                            # trata os dois casos igual, por segurança).
                            "cpf_cnpj": pedido["cpf_cnpj"] or None,
                            "telefone": None,
                        },
                        "itens": itens_resolvidos,
                        "parcelas": parcelas,
                    }
                )

            marcar_status(
                solicitacao_id, "pronto_para_revisao", relatorio={"pedidos": pedidos_resolvidos}
            )
        finally:
            con.close()
    finally:
        # Não acumula cópia a cada busca — já foi lida, não precisa ficar
        # ocupando disco (diferente da cópia manual de 2026-07-23, que foi
        # feita uma única vez e ficou guardada de propósito).
        try:
            os.remove(caminho_copia)
        except OSError:
            pass


def processar_pendentes():
    try:
        pendentes = buscar_pendentes()
    except Exception as e:
        print(f"Erro ao buscar solicitações pendentes: {e}")
        return

    for solicitacao in pendentes or []:
        solicitacao_id = solicitacao["id"]
        try:
            processar_solicitacao(solicitacao_id)
            print(f"Solicitação {solicitacao_id} processada.")
        except Exception as e:
            mensagem = str(e)
            print(f"Erro ao processar solicitação {solicitacao_id}: {mensagem}")
            try:
                marcar_status(solicitacao_id, "erro", erro=mensagem)
            except Exception as erro_ao_marcar:
                # Mesma rede de segurança do print-agent: se nem isso
                # funcionar, a solicitação fica "pendente" e é tentada de
                # novo no próximo ciclo, em vez de sumir silenciosamente.
                print(f"Erro ao marcar solicitação {solicitacao_id} como erro: {erro_ao_marcar}")


def main():
    print(
        f"Agente de importação GMax rodando — checando solicitações a cada "
        f"{INTERVALO_POLLING_MS}ms (arquivo: {CAMINHO_GMAX_FDB})"
    )
    while True:
        # Última rede de segurança — um processo que precisa ficar de pé
        # 24h/dia numa loja não pode morrer por uma exceção que escapou do
        # loop (mesmo espírito do uncaughtException/unhandledRejection do
        # print-agent).
        try:
            processar_pendentes()
        except Exception:
            traceback.print_exc()
        time.sleep(INTERVALO_POLLING_MS / 1000)


if __name__ == "__main__":
    main()
