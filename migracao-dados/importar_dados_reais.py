"""
Fase 5 — importa os dados reais exportados do GMax (migracao-dados/export_csv/)
pro Supabase real do ERP novo.

Uso:
  python importar_dados_reais.py --relatorio ARQUIVO_SAIDA.txt
      Só lê os CSVs e monta os dados em memória — não conecta no banco.
      Escreve um relatório (contagens, linhas puladas com motivo, amostras)
      no arquivo indicado, pra revisão antes de gravar qualquer coisa.

  SUPABASE_DB_PASSWORD=... python importar_dados_reais.py --executar
      Conecta no Supabase real e grava tudo numa transação só (tudo ou
      nada). Só roda depois do relatório ter sido revisado.

Decisões de mapeamento — ver a seção "Fase 5" do plano em
C:\\Users\\Micro\\.claude\\plans\\glowing-dreaming-music.md.
"""

import argparse
import csv
import os
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = os.path.join(SCRIPT_DIR, "export_csv")


def ler_csv(nome):
    caminho = os.path.join(EXPORT_DIR, nome)
    with open(caminho, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def norm(v):
    v = (v or "").strip()
    return v if v else None


def to_float(v):
    v = norm(v)
    if v is None:
        return 0.0
    try:
        return round(float(v), 2)
    except ValueError:
        return 0.0


def to_int(v):
    v = norm(v)
    if v is None:
        return 0
    try:
        return int(float(v))
    except ValueError:
        return 0


CATEGORIA_PALAVRAS = [
    ("alianca", "Alianças"),
    ("aliança", "Alianças"),
    ("anel", "Anéis"),
    ("brinco", "Brincos"),
    ("pulseira", "Pulseiras"),
    ("bracelete", "Pulseiras"),
    ("corrente", "Correntes"),
    ("cordao", "Correntes"),
    ("cordão", "Correntes"),
    ("gargantilha", "Colares"),
    ("colar", "Colares"),
    ("pingente", "Pingentes"),
    ("piercing", "Piercings"),
    ("tornozeleira", "Tornozeleiras"),
]


def inferir_categoria(nome):
    n = nome.lower()
    for chave, categoria in CATEGORIA_PALAVRAS:
        if chave in n:
            return categoria
    return "Diversos"


STATUS_MAPA = {"O": "orcamento", "R": "faturado", "C": "cancelado", "P": "orcamento"}


def forma_pagamento_de(descricao):
    d = (descricao or "").upper()
    if "DINHEIRO" in d:
        return "dinheiro"
    if "PIX" in d:
        return "pix"
    if "CARTAO" in d or "CARTÃO" in d:
        return "cartao_credito"
    if "CREDIARIO" in d or "CREDIÁRIO" in d or "BOLETO" in d:
        return "promissoria"
    return "dinheiro"


def montar_dados():
    """Lê os CSVs e monta as estruturas em memória. Não toca no banco."""
    relatorio = []

    def log(linha=""):
        relatorio.append(linha)

    # ---------------------------------------------------------------- CLIENTES
    pessoas = ler_csv("PESSOA.csv")
    enderecos = ler_csv("PESSOA_ENDERECO.csv")
    endereco_por_pessoa = {}
    for e in enderecos:
        pid = e["ID_PESSOA"]
        if e.get("PRINCIPAL") == "S" or pid not in endereco_por_pessoa:
            endereco_por_pessoa[pid] = e

    # Contagem de pedidos por PESSOA — usada pra separar clientes reais de
    # entidades de template do GMax (impostos, concessionárias, sindicatos)
    # que vêm marcadas CLIENTE='S' de fábrica mas nunca são usadas em venda
    # nenhuma. Achado real durante a importação: 37 PESSOA jurídicas com 0
    # pedidos (TRIBUTOS, CORREIOS, DAS/DAE/DARF/GPS/FGTS, concessionárias de
    # energia/telefone, SESI/SENAI/SEBRAE etc.) — nenhuma delas é cliente de
    # verdade. Empresas jurídicas que compraram de verdade (9 encontradas)
    # continuam entrando normalmente.
    cabecalhos_para_contagem = ler_csv("ORCAMENTO_PEDIDO_VENDA_CAB.csv")
    pedidos_por_pessoa = {}
    for cab in cabecalhos_para_contagem:
        pid = cab.get("ID_PESSOA")
        pedidos_por_pessoa[pid] = pedidos_por_pessoa.get(pid, 0) + 1

    clientes = []
    clientes_pulados = []
    cpf_vistos = set()
    for p in pessoas:
        if p.get("CLIENTE") != "S":
            continue
        if p.get("COLABORADOR") == "S":
            clientes_pulados.append((p["ID"], p["NOME"], "também marcado como colaborador — linha de sistema, não cliente real"))
            continue
        if p.get("FISICA_JURIDICA") == "J" and pedidos_por_pessoa.get(p["ID"], 0) == 0:
            clientes_pulados.append((p["ID"], p["NOME"], "pessoa jurídica sem nenhum pedido — entidade de template do GMax (imposto/concessionária/etc.), não cliente real"))
            continue
        cpf = norm(p.get("CPF_CNPJ"))
        if cpf and cpf in cpf_vistos:
            clientes_pulados.append((p["ID"], p["NOME"], f"CPF/CNPJ duplicado ({cpf})"))
            continue
        if cpf:
            cpf_vistos.add(cpf)
        end = endereco_por_pessoa.get(p["ID"], {})
        endereco_txt = " ".join(filter(None, [norm(end.get("LOGRADOURO")), norm(end.get("NUMERO"))])) or None
        clientes.append({
            "gmax_id": p["ID"],
            "nome": p["NOME"].strip(),
            "cpf_cnpj": cpf,
            "telefone": norm(p.get("CELULAR")) or norm(p.get("FONE1")),
            "cidade": norm(end.get("CIDADE")),
            "uf": norm(end.get("UF")),
            "endereco": endereco_txt,
            "ativo": p.get("ATIVO", "S") != "N",
        })

    log(f"CLIENTES — {len(clientes)} a importar, {len(clientes_pulados)} pulados")
    for gid, nome, motivo in clientes_pulados:
        log(f"  pulado: PESSOA.ID={gid} '{nome}' — {motivo}")
    log("  amostra (5 primeiros):")
    for c in clientes[:5]:
        log(f"    {c}")
    log()

    clientes_por_gmax_id = {c["gmax_id"]: c for c in clientes}

    # ---------------------------------------------------------------- PRODUTOS
    produtos_empresa = ler_csv("PRODUTO_EMPRESA.csv")
    produtos_raw = {p["ID"]: p for p in ler_csv("PRODUTO.csv")}

    produtos = []
    produtos_pulados = []
    for pe in produtos_empresa:
        base = produtos_raw.get(pe["ID_PRODUTO"], {})
        if base.get("EXCLUIDO") == "S":
            produtos_pulados.append((pe["ID"], pe["NOME"], "excluído no GMax"))
            continue
        nome = pe["NOME"].strip()
        valor_venda = to_float(pe.get("VALOR_VENDA"))
        multiplicador = 2.8
        codigo_peca = round(valor_venda / multiplicador, 2) if valor_venda else 0.0
        qtd = to_int(pe.get("QTD_ESTOQUE"))
        qtd_final = max(0, qtd)
        produtos.append({
            "gmax_id": pe["ID"],
            "nome": nome,
            "categoria": inferir_categoria(nome),
            "codigo_interno": norm(pe.get("CODIGO_INTERNO")),
            "codigo_peca": codigo_peca,
            "multiplicador": multiplicador,
            "quantidade_estoque": qtd_final,
            "quantidade_estoque_original": qtd,
            "ativo": base.get("INATIVO") != "S",
        })

    log(f"PRODUTOS — {len(produtos)} a importar, {len(produtos_pulados)} pulados")
    for gid, nome, motivo in produtos_pulados:
        log(f"  pulado: PRODUTO_EMPRESA.ID={gid} '{nome}' — {motivo}")
    negativos = [p for p in produtos if p["quantidade_estoque_original"] < 0]
    if negativos:
        log(f"  {len(negativos)} produto(s) com estoque negativo no GMax, zerados na importação:")
        for p in negativos:
            log(f"    {p['nome']}: {p['quantidade_estoque_original']} -> 0")
    log("  amostra (8 primeiros):")
    for p in produtos[:8]:
        log(f"    {p['nome']} | categoria={p['categoria']} | codigo_peca={p['codigo_peca']} x {p['multiplicador']} = {round(p['codigo_peca']*p['multiplicador'],2)} | estoque={p['quantidade_estoque']}")
    log()

    produtos_por_gmax_id = {p["gmax_id"]: p for p in produtos}

    # ---------------------------------------------------------------- PEDIDOS
    condicoes_raw = ler_csv("CONDICOES_PAGAMENTO.csv")
    condicao_id_para_forma = {c["ID"]: forma_pagamento_de(c["DESCRICAO"]) for c in condicoes_raw}

    cabecalhos = ler_csv("ORCAMENTO_PEDIDO_VENDA_CAB.csv")
    detalhes = ler_csv("ORCAMENTO_PEDIDO_VENDA_DET.csv")

    itens_por_pedido = {}
    for d in detalhes:
        itens_por_pedido.setdefault(d["ID_ORCAMENTO_VENDA_CABECALHO"], []).append(d)

    pedidos = []
    pedidos_pulados = []
    itens_pulados = []
    status_contagem = {}
    for cab in cabecalhos:
        gid = cab["ID"]
        cliente_gid = cab.get("ID_PESSOA")
        if cliente_gid not in clientes_por_gmax_id:
            pedidos_pulados.append((gid, f"cliente PESSOA.ID={cliente_gid} não foi importado (não é cliente real ou foi filtrado)"))
            continue

        itens_validos = []
        for d in itens_por_pedido.get(gid, []):
            produto_gid = d.get("ID_PRODUTO")
            if produto_gid not in produtos_por_gmax_id:
                itens_pulados.append((gid, produto_gid, "produto não importado"))
                continue
            qtd = to_int(d.get("QUANTIDADE"))
            if qtd <= 0:
                itens_pulados.append((gid, produto_gid, f"quantidade inválida ({d.get('QUANTIDADE')})"))
                continue
            itens_validos.append({
                "produto_gmax_id": produto_gid,
                "quantidade": qtd,
                "preco_unitario": to_float(d.get("VALOR_UNITARIO")),
            })

        if not itens_validos:
            pedidos_pulados.append((gid, "nenhum item válido"))
            continue

        sigla = cab.get("STATUS_PEDIDO", "")
        status = STATUS_MAPA.get(sigla, "orcamento")
        status_contagem[sigla] = status_contagem.get(sigla, 0) + 1

        forma_pagamento = condicao_id_para_forma.get(cab.get("ID_CONDICOES_PAGAMENTO")) if status != "orcamento" else None

        pedidos.append({
            "gmax_id": gid,
            "cliente_gmax_id": cliente_gid,
            "status": status,
            "forma_pagamento": forma_pagamento,
            "subtotal": to_float(cab.get("VALOR_SUBTOTAL")),
            "valor_desconto": to_float(cab.get("VALOR_DESCONTO")),
            "valor_acrescimo": to_float(cab.get("VALOR_ACRESCIMO")),
            "total": to_float(cab.get("VALOR_TOTAL")),
            "criado_em": cab.get("DATA_CADASTRO"),
            "itens": itens_validos,
            "numero_parcelas": 1,  # ajustado depois de montar contas_receber
        })

    log(f"PEDIDOS — {len(pedidos)} a importar, {len(pedidos_pulados)} pulados, {len(itens_pulados)} item(ns) de pedido pulado(s)")
    log(f"  distribuição de status (sigla GMax -> status novo, contagem): "
        + ", ".join(f"{s}->{STATUS_MAPA.get(s,'orcamento')}:{c}" for s, c in sorted(status_contagem.items())))
    for gid, motivo in pedidos_pulados[:15]:
        log(f"  pulado: ORCAMENTO_PEDIDO_VENDA_CAB.ID={gid} — {motivo}")
    if len(pedidos_pulados) > 15:
        log(f"  ... e mais {len(pedidos_pulados) - 15} pedido(s) pulado(s)")
    log("  amostra (5 primeiros):")
    for pe in pedidos[:5]:
        log(f"    gmax#{pe['gmax_id']} cliente_gmax={pe['cliente_gmax_id']} status={pe['status']} forma={pe['forma_pagamento']} total={pe['total']} itens={len(pe['itens'])}")
    log()

    pedidos_por_gmax_id = {pe["gmax_id"]: pe for pe in pedidos}

    # ---------------------------------------------------------- CONTAS_RECEBER
    lancamentos = {l["ID"]: l for l in ler_csv("LANCAMENTO_RECEBER.csv")}
    parcelas_raw = ler_csv("PARCELA_RECEBER.csv")

    contas_receber = []
    parcelas_puladas = []
    parcelas_por_pedido_gmax = {}
    for pr in parcelas_raw:
        valor = to_float(pr.get("TOTAL_PARCELA") or pr.get("VALOR"))
        venc = norm(pr.get("DATA_VENCIMENTO"))
        if valor <= 0 or not venc:
            continue  # linhas de template do GMax (ID 0 / -1), sem dado real
        lanc = lancamentos.get(pr.get("ID_LANCAMENTO_RECEBER"))
        if not lanc:
            parcelas_puladas.append((pr["ID"], "sem LANCAMENTO_RECEBER correspondente"))
            continue
        pedido_gid = lanc.get("ID_VENDA_CABECALHO")
        pedido = pedidos_por_gmax_id.get(pedido_gid)
        if not pedido:
            parcelas_puladas.append((pr["ID"], f"pedido gmax#{pedido_gid} não foi importado"))
            continue
        pago_em = norm(pr.get("DATA_PAGAMENTO"))
        conta = {
            "pedido_gmax_id": pedido_gid,
            "cliente_gmax_id": pedido["cliente_gmax_id"],
            "valor": valor,
            "vencimento": venc,
            "situacao": "pago" if pago_em else "em_dia",
            "pago_em": pago_em,
            "forma_pagamento": pedido["forma_pagamento"],
            "numero_parcela": to_int(pr.get("NUMERO_PARCELA")) or 1,
        }
        contas_receber.append(conta)
        parcelas_por_pedido_gmax.setdefault(pedido_gid, []).append(conta)

    # completa total_parcelas + ajusta numero_parcelas do pedido
    for pedido_gid, lista in parcelas_por_pedido_gmax.items():
        total = len(lista)
        for c in lista:
            c["total_parcelas"] = total
        pedidos_por_gmax_id[pedido_gid]["numero_parcelas"] = max(1, total)

    log(f"CONTAS_RECEBER — {len(contas_receber)} a importar, {len(parcelas_puladas)} pulada(s)")
    for pid, motivo in parcelas_puladas[:15]:
        log(f"  pulada: PARCELA_RECEBER.ID={pid} — {motivo}")
    if len(parcelas_puladas) > 15:
        log(f"  ... e mais {len(parcelas_puladas) - 15} parcela(s) pulada(s)")
    pagas = sum(1 for c in contas_receber if c["situacao"] == "pago")
    log(f"  {pagas} já pagas, {len(contas_receber) - pagas} em aberto")
    log("  amostra (5 primeiras):")
    for c in contas_receber[:5]:
        log(f"    {c}")
    log()

    # ------------------------------------------------------------ CONTAS_PAGAR
    log("CONTAS_PAGAR — 0 a importar (LANCAMENTO_PAGAR/PARCELA_PAGAR só têm linha de template no GMax, sem dado real)")
    log()

    return {
        "clientes": clientes,
        "produtos": produtos,
        "pedidos": pedidos,
        "contas_receber": contas_receber,
        "relatorio": relatorio,
    }


def escrever_relatorio(dados, caminho_saida):
    with open(caminho_saida, "w", encoding="utf-8") as f:
        f.write(f"Relatório de importação — Fase 5 — gerado em {datetime.now().isoformat()}\n")
        f.write("=" * 70 + "\n\n")
        f.write("\n".join(dados["relatorio"]))
        f.write("\n\nRESUMO FINAL:\n")
        f.write(f"  clientes: {len(dados['clientes'])}\n")
        f.write(f"  produtos: {len(dados['produtos'])}\n")
        f.write(f"  pedidos: {len(dados['pedidos'])}\n")
        f.write(f"  itens de pedido: {sum(len(p['itens']) for p in dados['pedidos'])}\n")
        f.write(f"  contas_receber: {len(dados['contas_receber'])}\n")


def executar_importacao(dados):
    import psycopg2
    import psycopg2.extras

    senha = os.environ["SUPABASE_DB_PASSWORD"]
    conn = psycopg2.connect(
        host="aws-1-sa-east-1.pooler.supabase.com", port=5432, dbname="postgres",
        user="postgres.cdbvudqmopjtbnpewhfc", password=senha,
        sslmode="require", connect_timeout=15,
    )
    cur = conn.cursor()
    try:
        # ---- clientes
        cliente_id_por_gmax = {}
        for c in dados["clientes"]:
            cur.execute(
                """insert into public.clientes (nome, cpf_cnpj, telefone, cidade, uf, endereco, ativo)
                   values (%s, %s, %s, %s, %s, %s, %s) returning id""",
                (c["nome"], c["cpf_cnpj"], c["telefone"], c["cidade"], c["uf"], c["endereco"], c["ativo"]),
            )
            cliente_id_por_gmax[c["gmax_id"]] = cur.fetchone()[0]
        print(f"clientes inseridos: {len(cliente_id_por_gmax)}")

        # ---- produtos
        produto_id_por_gmax = {}
        for p in dados["produtos"]:
            cur.execute(
                """insert into public.produtos
                   (nome, categoria, codigo_interno, codigo_peca, multiplicador, quantidade_estoque, ativo)
                   values (%s, %s, %s, %s, %s, %s, %s) returning id""",
                (p["nome"], p["categoria"], p["codigo_interno"], p["codigo_peca"], p["multiplicador"],
                 p["quantidade_estoque"], p["ativo"]),
            )
            produto_id_por_gmax[p["gmax_id"]] = cur.fetchone()[0]
        print(f"produtos inseridos: {len(produto_id_por_gmax)}")

        # ---- pedidos + itens
        pedido_id_por_gmax = {}
        for pe in dados["pedidos"]:
            cliente_id = cliente_id_por_gmax.get(pe["cliente_gmax_id"])
            cur.execute(
                """insert into public.pedidos
                   (cliente_id, status, forma_pagamento, subtotal, valor_desconto, valor_acrescimo,
                    total, numero_parcelas, criado_em)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                (cliente_id, pe["status"], pe["forma_pagamento"], pe["subtotal"], pe["valor_desconto"],
                 pe["valor_acrescimo"], pe["total"], pe["numero_parcelas"], pe["criado_em"]),
            )
            pedido_id = cur.fetchone()[0]
            pedido_id_por_gmax[pe["gmax_id"]] = pedido_id

            for item in pe["itens"]:
                produto_id = produto_id_por_gmax.get(item["produto_gmax_id"])
                cur.execute(
                    """insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario)
                       values (%s, %s, %s, %s)""",
                    (pedido_id, produto_id, item["quantidade"], item["preco_unitario"]),
                )
        print(f"pedidos inseridos: {len(pedido_id_por_gmax)}")

        # ---- contas_receber
        total_contas = 0
        for c in dados["contas_receber"]:
            pedido_id = pedido_id_por_gmax.get(c["pedido_gmax_id"])
            cliente_id = cliente_id_por_gmax.get(c["cliente_gmax_id"])
            if not pedido_id or not cliente_id:
                continue
            cur.execute(
                """insert into public.contas_receber
                   (pedido_id, cliente_id, valor, vencimento, situacao, pago_em, forma_pagamento,
                    numero_parcela, total_parcelas)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (pedido_id, cliente_id, c["valor"], c["vencimento"], c["situacao"], c["pago_em"],
                 c["forma_pagamento"], c["numero_parcela"], c["total_parcelas"]),
            )
            total_contas += 1
        print(f"contas_receber inseridas: {total_contas}")

        conn.commit()
        print("OK — transação commitada.")
    except Exception:
        conn.rollback()
        print("FALHOU — transação desfeita (rollback), nada foi gravado.")
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser()
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--relatorio", metavar="ARQUIVO", help="só monta os dados e escreve um relatório, sem tocar no banco")
    grupo.add_argument("--executar", action="store_true", help="grava de verdade no Supabase (precisa de SUPABASE_DB_PASSWORD)")
    args = parser.parse_args()

    dados = montar_dados()

    if args.relatorio:
        escrever_relatorio(dados, args.relatorio)
        print(f"Relatório escrito em {args.relatorio}")
    elif args.executar:
        executar_importacao(dados)


if __name__ == "__main__":
    main()
