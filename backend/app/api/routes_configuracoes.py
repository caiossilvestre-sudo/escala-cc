from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_colaborador, require_admin
from app.db.models import Colaborador, Configuracao
from app.db.session import get_db
from app.schemas import ConfiguracaoIn, ConfiguracaoOut

router = APIRouter(prefix="/configuracoes", tags=["configuracoes"])

# Valores padrão usados quando o admin ainda não personalizou nada.
# {nome} é substituído pelo nome do colaborador na hora de exibir.
VALORES_PADRAO = {
    "mensagem_aniversario": "🎉 Feliz aniversário, {nome}! Toda a equipe deseja um dia incrível. 🎂",
    "mensagem_aniversario_trabalho": "🎊 Parabéns pelos {anos} ano(s) de casa, {nome}! Obrigado pela dedicação todos esses anos.",
}


@router.get("/{chave}", response_model=ConfiguracaoOut)
def obter(chave: str, db: Session = Depends(get_db), user: Colaborador = Depends(get_current_colaborador)):
    cfg = db.get(Configuracao, chave)
    if cfg:
        return cfg
    return ConfiguracaoOut(chave=chave, valor=VALORES_PADRAO.get(chave, ""))


@router.patch("/{chave}", response_model=ConfiguracaoOut)
def salvar(chave: str, body: ConfiguracaoIn, db: Session = Depends(get_db), admin: Colaborador = Depends(require_admin)):
    cfg = db.get(Configuracao, chave)
    if cfg:
        cfg.valor = body.valor
    else:
        cfg = Configuracao(chave=chave, valor=body.valor)
        db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg
