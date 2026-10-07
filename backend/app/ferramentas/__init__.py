"""Módulo Ferramentas do Escala — LifeGuard · Documentação de câmeras.

Pasta isolada: tabelas próprias (ft_*), rotas próprias (/ferramentas) e
permissão própria (N1/N2/Admin). Para ligar no Escala basta, no main.py:

    from app.ferramentas import router as ferramentas_router
    app.include_router(ferramentas_router)
"""
from app.ferramentas import models  # noqa: F401  (registra as tabelas antes do create_all)
from app.ferramentas.routes import router

__all__ = ["router"]
