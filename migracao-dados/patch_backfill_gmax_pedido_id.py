# -*- coding: utf-8 -*-
# Script de uso único (2026-07-24): casa pedidos Trolesi ja existentes
# (vindos de importacoes antigas, sem idempotency_key) contra o pedido GMax
# correspondente, e grava pedidos.gmax_pedido_id só quando a correspondência
# for exata e sem ambiguidade (1 pedido Trolesi <-> 1 pedido GMax pela
# mesma chave cliente+valor+data). Não apagar depois de rodar -- registrar
# em DECISIONS.md e remover manualmente.
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapeamento_pagamento import STATUS_IMPORTAVEIS  # noqa: E402

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
env = {}
with open(ENV_PATH, "r", encoding="utf-8") as f:
    for linha in f:
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        k, v = linha.split("=", 1)
        env[k.strip()] = v.strip()

SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = env["SUPABASE_SERVICE_ROLE_KEY"]


def sb(caminho, metodo="GET", corpo=None):
    url = f"{SUPABASE_URL}/rest/v1{caminho}"
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    cabecalhos = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if metodo == "PATCH":
        cabecalhos["Prefer"] = "return=minimal"
    req = urllib.request.Request(url, data=dados, headers=cabecalhos, method=metodo)
    with urllib.request.urlopen(req) as resp:
        corpo_resposta = resp.read()
        return json.loads(corpo_resposta) if corpo_resposta else None


def utc_para_data_brasilia(iso_str):
    # Achado rodando este script contra dado real: os pedidos historicos
    # (Fase 5 + reconciliacao de 2026-07-22) foram gravados com criado_em
    # em MEIA-NOITE UTC (ex: "2026-05-22T00:00:00+00:00"), nao meio-dia
    # Brasilia como deveria (mesma classe de bug de fuso ja documentada
    # neste projeto antes) -- a data pretendida e a propria data UTC ali,
    # nao "UTC menos 3h" (que rolaria pro dia anterior). Por isso aqui e so
    # a data crua, sem conversao de fuso nenhuma -- especifico pra casar
    # contra ESSAS linhas historicas com essa ancoragem conhecida, nao um
    # padrao geral pra "que dia e hoje" (esse continua sendo
    # src/lib/datas.ts, que usa meio-dia Brasilia corretamente).
    return iso_str.split("T")[0]


print("Buscando pedidos Trolesi candidatos (sem gmax_pedido_id, sem idempotency_key)...")
trolesi_raw = sb(
    "/pedidos?gmax_pedido_id=is.null&idempotency_key=is.null"
    "&select=id,numero,total,criado_em,clientes(cpf_cnpj)"
)
print(f"{len(trolesi_raw)} candidatos Trolesi.")

trolesi_por_chave = {}
for p in trolesi_raw:
    cpf = (p.get("clientes") or {}).get("cpf_cnpj") or ""
    cpf = cpf.strip()
    if not cpf:
        continue
    chave = (cpf, round(float(p["total"]), 2), utc_para_data_brasilia(p["criado_em"]))
    trolesi_por_chave.setdefault(chave, []).append(p)

print("Lendo GMax (cópia local, nunca o arquivo ao vivo)...")
import shutil
copia = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_backfill_copia.fdb")
shutil.copy2(env.get("CAMINHO_GMAX_FDB", r"C:\GMax\GMaxERP.FDB"), copia)

import fdb
fdb.load_api(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fbembed", "fbembed.dll"))
con = fdb.connect(dsn=copia, user="SYSDBA", password="masterkey")
cur = con.cursor()
cur.execute(
    "select id, cpf_cnpj, valor_total, data_cadastro from ORCAMENTO_PEDIDO_VENDA_CAB "
    "where status_pedido in ({})".format(",".join(f"'{s}'" for s in STATUS_IMPORTAVEIS))
)
gmax_rows = cur.fetchall()
con.close()
os.remove(copia)
print(f"{len(gmax_rows)} pedidos GMax com status importável (todo o histórico).")

print("Buscando gmax_pedido_id já vinculados (pra nunca reusar um GMax id já casado)...")
ja_vinculados_raw = sb("/pedidos?gmax_pedido_id=not.is.null&select=gmax_pedido_id")
ja_vinculados = {r["gmax_pedido_id"] for r in ja_vinculados_raw}
print(f"{len(ja_vinculados)} já vinculados, excluídos do casamento.")

gmax_por_chave = {}
for row in gmax_rows:
    gmax_id, cpf, valor_total, data_cadastro = row
    if gmax_id in ja_vinculados:
        continue
    cpf = (cpf or "").strip()
    if not cpf:
        continue
    chave = (cpf, round(float(valor_total), 2), data_cadastro.isoformat())
    gmax_por_chave.setdefault(chave, []).append(gmax_id)

print("\n=== Casando ===")
casados = 0
ambiguos = []
for chave, trolesi_list in trolesi_por_chave.items():
    gmax_list = gmax_por_chave.get(chave)
    if not gmax_list:
        continue
    if len(trolesi_list) == 1 and len(gmax_list) == 1:
        pedido = trolesi_list[0]
        gmax_id = gmax_list[0]
        sb(f"/pedidos?id=eq.{pedido['id']}", "PATCH", {"gmax_pedido_id": gmax_id})
        print(f"Trolesi #{pedido['numero']} <-> GMax #{gmax_id} (chave {chave})")
        casados += 1
    else:
        ambiguos.append((chave, trolesi_list, gmax_list))

print(f"\nCasados e gravados: {casados}")
print(f"Ambíguos (não tocados): {len(ambiguos)}")
for chave, tl, gl in ambiguos:
    print(f"  chave {chave}: {len(tl)} pedido(s) Trolesi x {len(gl)} pedido(s) GMax -> {[t['numero'] for t in tl]} x {gl}")

trolesi_sem_match = [p for chave, ps in trolesi_por_chave.items() if chave not in gmax_por_chave for p in ps]
print(f"\nPedidos Trolesi sem nenhuma correspondência no GMax: {len(trolesi_sem_match)}")
for p in trolesi_sem_match:
    print(f"  Trolesi #{p['numero']} total={p['total']}")
