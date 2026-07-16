"""
Patch pontual (roda uma vez): preenche NCM/CSOSN reais dos 44 produtos já
importados na Fase 5 — não vieram no primeiro import porque na hora não
tínhamos ainda o módulo Fiscal desenhado. Casa por nome (mesma fonte,
PRODUTO_EMPRESA.NOME, usada no import original) contra o produto já
existente no Supabase.

Uso:
  SUPABASE_DB_PASSWORD=... python patch_ncm_csosn.py --relatorio
  SUPABASE_DB_PASSWORD=... python patch_ncm_csosn.py --executar
"""

import argparse
import csv
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = os.path.join(SCRIPT_DIR, "export_csv")


def ler_csv(nome):
    with open(os.path.join(EXPORT_DIR, nome), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def norm(v):
    v = (v or "").strip()
    return v if v else None


def montar_mapa():
    produtos_raw = {p["ID"]: p for p in ler_csv("PRODUTO.csv")}
    produtos_empresa = ler_csv("PRODUTO_EMPRESA.csv")

    mapa = {}
    for pe in produtos_empresa:
        base = produtos_raw.get(pe["ID_PRODUTO"], {})
        nome = pe["NOME"].strip()
        ncm = norm(base.get("NCM"))
        csosn = norm(base.get("CSOSN"))
        mapa[nome] = {"ncm": ncm, "csosn": csosn or "101"}
    return mapa


def main():
    parser = argparse.ArgumentParser()
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--relatorio", action="store_true")
    grupo.add_argument("--executar", action="store_true")
    args = parser.parse_args()

    mapa = montar_mapa()

    import psycopg2

    senha = os.environ["SUPABASE_DB_PASSWORD"]
    conn = psycopg2.connect(
        host="aws-1-sa-east-1.pooler.supabase.com", port=5432, dbname="postgres",
        user="postgres.cdbvudqmopjtbnpewhfc", password=senha,
        sslmode="require", connect_timeout=15,
    )
    cur = conn.cursor()
    cur.execute("select id, nome from public.produtos")
    produtos_reais = cur.fetchall()

    encontrados = []
    nao_encontrados = []
    for produto_id, nome in produtos_reais:
        dados = mapa.get(nome)
        if dados and dados["ncm"]:
            encontrados.append((produto_id, nome, dados["ncm"], dados["csosn"]))
        else:
            nao_encontrados.append(nome)

    print(f"produtos no Supabase: {len(produtos_reais)}")
    print(f"com NCM encontrado no GMax: {len(encontrados)}")
    print(f"sem match (ficam com csosn padrão '101' e ncm nulo): {len(nao_encontrados)}")
    for nome in nao_encontrados:
        print("  sem match:", nome)

    if args.executar:
        for produto_id, nome, ncm, csosn in encontrados:
            cur.execute(
                "update public.produtos set ncm = %s, csosn = %s where id = %s",
                (ncm, csosn, produto_id),
            )
        conn.commit()
        print(f"OK — {len(encontrados)} produto(s) atualizado(s).")
    else:
        print("\nModo relatório — nada foi gravado. Rode com --executar pra aplicar.")

    conn.close()


if __name__ == "__main__":
    main()
