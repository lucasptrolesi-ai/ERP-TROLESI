# -*- coding: utf-8 -*-
# Script de uso único (2026-07-25): converte pra maiúsculo o texto livre já
# gravado antes da mudança de "tudo digitado vira caixa alta" (ver
# `normalizarCampo`/`FormField` no código e a migration irmã
# `supabase/migrations/20260725000001_normaliza_texto_caixa_alta.sql`, que
# faz o mesmo via UPDATE direto no Postgres). Este script existe como
# alternativa via REST (service_role), sem precisar da senha do Postgres —
# só lê/grava tabela por tabela, pulando linha que já está maiúscula.
#
# Uso:
#   python patch_caixa_alta_dados_existentes.py --relatorio
#       Só mostra quantas linhas mudariam por tabela — não grava nada.
#   python patch_caixa_alta_dados_existentes.py --executar
#       Aplica de verdade, linha por linha (PATCH só nos campos que mudam).
import argparse
import json
import os
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(SCRIPT_DIR, "..", ".env.local")

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

# Mesma decisão de escopo da migration SQL irmã: só coluna de texto livre
# digitado por gente. Enum/status/código controlado, e-mail/URL/CPF/CNPJ/
# telefone/CEP/id, texto gerado pelo sistema (motivo_avaliacao,
# garantias.justificativa — essa mistura texto de gente com texto gerado
# por avaliarGarantiaFolheado na mesma coluna, sem jeito de distinguir uma
# linha existente da outra) e audit_log (trilha de auditoria, não faz
# sentido reescrever o passado) ficam de fora — ver o comentário de
# cabeçalho da migration SQL pra justificativa completa de cada exclusão.
TABELAS = {
    "clientes": [
        "nome", "cidade", "bairro", "endereco", "razao_social", "nome_fantasia",
        "situacao_cadastral", "natureza_juridica", "porte", "atividade_principal", "uf",
    ],
    "fornecedores": ["nome", "cidade", "uf"],
    "produtos": [
        "nome", "categoria", "subcategoria", "subsubcategoria", "codigo_interno",
        "codigo_barras", "referencia", "descricao", "material", "tipo_banho",
        "colecao", "cor", "tamanho", "genero",
    ],
    "profiles": ["nome"],
    "abatimentos": ["material", "tipo_peca", "estado_descricao"],
    "garantias": ["parecer", "numero_serie", "partes_faltando"],
    "crediario_lancamentos": ["recibo_numero"],
    "expedicoes": [
        "endereco_entrega", "destinatario", "transportadora", "modalidade",
        "motivo_frete_gratis", "rastreamento",
    ],
    "contas_pagar": ["descricao", "observacao_baixa"],
    "contas_receber": ["observacao_baixa"],
    "notas_fiscais": ["natureza_operacao"],
}


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


def main():
    parser = argparse.ArgumentParser()
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--relatorio", action="store_true")
    grupo.add_argument("--executar", action="store_true")
    args = parser.parse_args()

    total_geral = 0
    for tabela, colunas in TABELAS.items():
        select = "id," + ",".join(colunas)
        linhas = sb(f"/{tabela}?select={select}&limit=10000")

        mudam = 0
        for linha in linhas:
            alteracoes = {}
            for coluna in colunas:
                valor = linha.get(coluna)
                if valor is not None and valor != valor.upper():
                    alteracoes[coluna] = valor.upper()
            if alteracoes:
                mudam += 1
                if args.executar:
                    sb(f"/{tabela}?id=eq.{linha['id']}", "PATCH", alteracoes)

        total_geral += mudam
        acao = "atualizada(s)" if args.executar else "mudariam"
        print(f"{tabela}: {mudam}/{len(linhas)} linha(s) {acao}")

    if args.executar:
        print(f"\nOK — {total_geral} linha(s) atualizada(s) no total.")
    else:
        print(f"\nTotal que mudaria: {total_geral} linha(s). Modo relatório — nada foi gravado.")
        print("Rode com --executar pra aplicar.")


if __name__ == "__main__":
    main()
