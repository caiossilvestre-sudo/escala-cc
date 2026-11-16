"""Rotina diária: busca o volume do mês no Checkpoint sozinha (sem cron, sem passo manual).

Roda numa thread do próprio backend, todo dia às 06:00 (horário de São Paulo), e uma vez
~1 min depois de subir se a última busca tem mais de 24 h. Nos 3 primeiros dias do mês
também refaz o mês anterior (o último dia costuma ser preenchido atrasado). Com 2 workers
a busca pode rodar duas vezes, o que é inofensivo: ela só regrava os mesmos números.
Sem CHECKPOINT_API_KEY não faz nada.
"""
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.custos.routes import registrar_sync, sincronizar_mes
from app.db.session import SessionLocal

TZ = ZoneInfo("America/Sao_Paulo")
HORA = 6


def _meses(agora: datetime) -> list[str]:
    meses = [agora.strftime("%Y-%m")]
    if agora.day <= 3:
        meses.append((agora.replace(day=1) - timedelta(days=1)).strftime("%Y-%m"))
    return meses


def executar(origem: str = "auto"):
    db = SessionLocal()
    try:
        meses = _meses(datetime.now(TZ))
        try:
            for m in meses:
                sincronizar_mes(db, m)
            registrar_sync(db, origem, True, ", ".join(meses))
        except Exception as e:  # noqa: BLE001 — nunca derruba o backend
            db.rollback()
            detalhe = getattr(e, "detail", None) or str(e)
            registrar_sync(db, origem, False, str(detalhe)[:200])
            print(f"[custos] sincronização com o Checkpoint falhou: {detalhe}")
    finally:
        db.close()


def _precisa_agora() -> bool:
    from app.custos.routes import _ultima_sync
    db = SessionLocal()
    try:
        u = _ultima_sync(db)
    finally:
        db.close()
    if not u or not u["ok"]:
        return True
    try:
        return datetime.now() - datetime.fromisoformat(u["quando"]) > timedelta(hours=24)
    except ValueError:
        return True


def _loop():
    time.sleep(60)
    if _precisa_agora():
        executar("auto-inicio")
    while True:
        agora = datetime.now(TZ)
        proximo = agora.replace(hour=HORA, minute=0, second=0, microsecond=0)
        if proximo <= agora:
            proximo += timedelta(days=1)
        time.sleep(max(60, (proximo - agora).total_seconds()))
        executar("auto")


def iniciar_agendador():
    if not settings.checkpoint_api_key:
        return
    threading.Thread(target=_loop, name="custos-sync", daemon=True).start()
