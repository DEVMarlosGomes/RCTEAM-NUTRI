"""Pagamentos e cobrança: plano de cada aluno, histórico de pagamentos e alunos com plano vencendo.

O plano fica no próprio paciente (`patients.assinatura`); cada pagamento vai para a collection
`pagamentos` e, por padrão, renova o vencimento do plano.
"""
import calendar
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

TZ_BR = ZoneInfo("America/Sao_Paulo")
FORMAS_PAGAMENTO = {"pix", "cartao_credito", "cartao_debito", "dinheiro", "transferencia", "boleto", "outro"}
CANAIS_COBRANCA = {"whatsapp", "email", "telefone", "presencial", "outro"}


class AssinaturaIn(BaseModel):
    plano: str = Field(min_length=2, max_length=80)
    valor: float = Field(ge=0)
    duracao_meses: int = Field(default=1, ge=1, le=24)
    inicio: Optional[str] = None
    vencimento: str
    observacao: Optional[str] = Field(default=None, max_length=500)


class PagamentoIn(BaseModel):
    valor: float = Field(gt=0)
    data_pagamento: Optional[str] = None
    forma: str = "pix"
    observacao: Optional[str] = Field(default=None, max_length=500)
    renovar: bool = True
    meses: Optional[int] = Field(default=None, ge=1, le=24)
    novo_vencimento: Optional[str] = None


class CobrancaIn(BaseModel):
    canal: str = "whatsapp"
    observacao: Optional[str] = Field(default=None, max_length=300)


def hoje_br() -> date:
    return datetime.now(TZ_BR).date()


def parse_data(value: Optional[str], campo: str) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise HTTPException(400, f"Data inválida em '{campo}'. Use AAAA-MM-DD.")


def somar_meses(base: date, meses: int) -> date:
    mes_total = base.month - 1 + meses
    ano, mes = base.year + mes_total // 12, mes_total % 12 + 1
    return date(ano, mes, min(base.day, calendar.monthrange(ano, mes)[1]))


def situacao_plano(assinatura: Optional[dict], janela: int, hoje: date) -> dict:
    """Classifica o plano: sem_plano, cancelado, vencido, vencendo (até `janela` dias) ou em_dia."""
    if not assinatura or not assinatura.get("vencimento"):
        return {"status": "sem_plano", "dias": None}
    if assinatura.get("ativo") is False:
        return {"status": "cancelado", "dias": None}
    try:
        venc = date.fromisoformat(str(assinatura["vencimento"])[:10])
    except ValueError:
        return {"status": "sem_plano", "dias": None}
    dias = (venc - hoje).days
    if dias < 0:
        status = "vencido"
    elif dias <= janela:
        status = "vencendo"
    else:
        status = "em_dia"
    return {"status": status, "dias": dias}


def build_financeiro_router(db, require_nutritionist) -> APIRouter:
    router = APIRouter()

    async def paciente_do_nutri(pid: str, nid: str) -> dict:
        patient = await db.patients.find_one({"id": pid, "nutricionista_id": nid}, {"_id": 0})
        if not patient:
            raise HTTPException(404, "Paciente não encontrado")
        return patient

    def linha_aluno(p: dict, janela: int, hoje: date) -> dict:
        assinatura = p.get("assinatura") or None
        return {
            "id": p["id"],
            "nome": p.get("nome"),
            "telefone": p.get("telefone") or "",
            "email": p.get("email") or "",
            "status_funil": p.get("status_funil"),
            "assinatura": assinatura,
            **situacao_plano(assinatura, janela, hoje),
        }

    @router.get("/financeiro/alunos")
    async def listar_alunos(janela: int = Query(7, ge=0, le=90), user=Depends(require_nutritionist)):
        hoje = hoje_br()
        rows = await db.patients.find(
            {"nutricionista_id": user["id"]},
            {"_id": 0, "id": 1, "nome": 1, "telefone": 1, "email": 1, "status_funil": 1, "assinatura": 1},
        ).to_list(2000)
        alunos = [linha_aluno(p, janela, hoje) for p in rows]
        ordem = {"vencido": 0, "vencendo": 1, "em_dia": 2, "sem_plano": 3, "cancelado": 4}
        alunos.sort(key=lambda a: (ordem[a["status"]], a["dias"] if a["dias"] is not None else 0, (a["nome"] or "").lower()))
        return alunos

    @router.get("/financeiro/resumo")
    async def resumo(janela: int = Query(7, ge=0, le=90), user=Depends(require_nutritionist)):
        alunos = await listar_alunos(janela=janela, user=user)
        hoje = hoje_br()
        inicio_mes = hoje.replace(day=1).isoformat()
        fim_mes = hoje.replace(day=calendar.monthrange(hoje.year, hoje.month)[1]).isoformat()
        recebido = 0.0
        async for pg in db.pagamentos.find(
            {"nutricionista_id": user["id"], "data_pagamento": {"$gte": inicio_mes, "$lte": fim_mes}},
            {"valor": 1},
        ):
            recebido += float(pg.get("valor") or 0)
        contagem = {s: 0 for s in ("vencido", "vencendo", "em_dia", "sem_plano", "cancelado")}
        a_receber_mes = 0.0
        for a in alunos:
            contagem[a["status"]] += 1
            venc = (a.get("assinatura") or {}).get("vencimento") or ""
            if a["status"] in ("vencido", "vencendo", "em_dia") and venc[:10] <= fim_mes:
                a_receber_mes += float((a["assinatura"] or {}).get("valor") or 0)
        return {
            "janela_dias": janela,
            "contagem": contagem,
            "recebido_mes": round(recebido, 2),
            "a_receber_mes": round(a_receber_mes, 2),
            "cobrar": [a for a in alunos if a["status"] in ("vencido", "vencendo")],
        }

    @router.get("/financeiro/pagamentos")
    async def listar_pagamentos(limit: int = Query(50, ge=1, le=500), user=Depends(require_nutritionist)):
        rows = await db.pagamentos.find({"nutricionista_id": user["id"]}, {"_id": 0}) \
            .sort([("data_pagamento", -1), ("created_at", -1)]).to_list(limit)
        ids = list({r["paciente_id"] for r in rows})
        nomes = {p["id"]: p.get("nome") async for p in db.patients.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "nome": 1})}
        for r in rows:
            r["paciente_nome"] = nomes.get(r["paciente_id"], "Paciente removido")
        return rows

    @router.put("/patients/{pid}/assinatura")
    async def salvar_assinatura(pid: str, payload: AssinaturaIn, user=Depends(require_nutritionist)):
        patient = await paciente_do_nutri(pid, user["id"])
        venc = parse_data(payload.vencimento, "vencimento")
        inicio = parse_data(payload.inicio, "inicio")
        anterior = patient.get("assinatura") or {}
        assinatura = {
            **anterior,
            "plano": payload.plano.strip(),
            "valor": round(payload.valor, 2),
            "duracao_meses": payload.duracao_meses,
            "inicio": inicio.isoformat() if inicio else anterior.get("inicio"),
            "vencimento": venc.isoformat(),
            "observacao": payload.observacao,
            "ativo": True,
            "atualizado_em": datetime.now(timezone.utc).isoformat(),
        }
        await db.patients.update_one({"id": pid}, {"$set": {"assinatura": assinatura}})
        return assinatura

    @router.delete("/patients/{pid}/assinatura")
    async def cancelar_assinatura(pid: str, user=Depends(require_nutritionist)):
        patient = await paciente_do_nutri(pid, user["id"])
        if not patient.get("assinatura"):
            raise HTTPException(404, "Paciente sem plano cadastrado")
        await db.patients.update_one({"id": pid}, {"$set": {
            "assinatura.ativo": False,
            "assinatura.atualizado_em": datetime.now(timezone.utc).isoformat(),
        }})
        return {"ok": True}

    @router.get("/patients/{pid}/pagamentos")
    async def pagamentos_do_paciente(pid: str, user=Depends(require_nutritionist)):
        await paciente_do_nutri(pid, user["id"])
        return await db.pagamentos.find({"paciente_id": pid}, {"_id": 0}) \
            .sort([("data_pagamento", -1), ("created_at", -1)]).to_list(200)

    @router.post("/patients/{pid}/pagamentos", status_code=201)
    async def registrar_pagamento(pid: str, payload: PagamentoIn, user=Depends(require_nutritionist)):
        patient = await paciente_do_nutri(pid, user["id"])
        if payload.forma not in FORMAS_PAGAMENTO:
            raise HTTPException(400, f"Forma de pagamento inválida. Use uma de: {sorted(FORMAS_PAGAMENTO)}")
        data_pg = parse_data(payload.data_pagamento, "data_pagamento") or hoje_br()
        assinatura = patient.get("assinatura") or {}
        venc_atual = parse_data(assinatura.get("vencimento"), "vencimento")
        novo_venc = None
        if payload.renovar:
            if not assinatura:
                raise HTTPException(400, "Cadastre o plano do aluno antes de renovar pelo pagamento")
            novo_venc = parse_data(payload.novo_vencimento, "novo_vencimento")
            if not novo_venc:
                # Pagou antes de vencer: mantém o ciclo. Pagou atrasado: o novo ciclo começa no pagamento.
                base = venc_atual if venc_atual and venc_atual >= data_pg else data_pg
                novo_venc = somar_meses(base, payload.meses or int(assinatura.get("duracao_meses") or 1))
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "paciente_id": pid,
            "nutricionista_id": user["id"],
            "valor": round(payload.valor, 2),
            "data_pagamento": data_pg.isoformat(),
            "forma": payload.forma,
            "observacao": payload.observacao,
            "plano": assinatura.get("plano"),
            "vencimento_anterior": venc_atual.isoformat() if venc_atual else None,
            "novo_vencimento": novo_venc.isoformat() if novo_venc else None,
            "created_at": now,
        }
        await db.pagamentos.insert_one(doc)
        if novo_venc:
            await db.patients.update_one({"id": pid}, {"$set": {
                "assinatura.vencimento": novo_venc.isoformat(),
                "assinatura.ativo": True,
                "assinatura.ultimo_pagamento": data_pg.isoformat(),
                "assinatura.atualizado_em": now,
            }})
        doc.pop("_id", None)
        return doc

    @router.delete("/patients/{pid}/pagamentos/{pgid}")
    async def excluir_pagamento(pid: str, pgid: str, user=Depends(require_nutritionist)):
        patient = await paciente_do_nutri(pid, user["id"])
        pg = await db.pagamentos.find_one({"id": pgid, "paciente_id": pid})
        if not pg:
            raise HTTPException(404, "Pagamento não encontrado")
        await db.pagamentos.delete_one({"id": pgid})
        # Desfaz a renovação somente se este pagamento foi o último a mexer no vencimento.
        assinatura = patient.get("assinatura") or {}
        revertido = False
        if pg.get("novo_vencimento") and pg["novo_vencimento"] == assinatura.get("vencimento") and pg.get("vencimento_anterior"):
            await db.patients.update_one({"id": pid}, {"$set": {"assinatura.vencimento": pg["vencimento_anterior"]}})
            revertido = True
        return {"ok": True, "vencimento_revertido": revertido}

    @router.post("/patients/{pid}/cobranca")
    async def registrar_cobranca(pid: str, payload: CobrancaIn, user=Depends(require_nutritionist)):
        patient = await paciente_do_nutri(pid, user["id"])
        if not patient.get("assinatura"):
            raise HTTPException(400, "Paciente sem plano cadastrado")
        if payload.canal not in CANAIS_COBRANCA:
            raise HTTPException(400, f"Canal inválido. Use um de: {sorted(CANAIS_COBRANCA)}")
        entrada = {"data": datetime.now(timezone.utc).isoformat(), "canal": payload.canal, "observacao": payload.observacao}
        await db.patients.update_one({"id": pid}, {
            "$set": {"assinatura.ultima_cobranca": entrada},
            "$push": {"assinatura.cobrancas": {"$each": [entrada], "$slice": -30}},
        })
        return entrada

    return router
