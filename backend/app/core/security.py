"""
Funções de segurança: hashing de senha e tokens JWT.

Escolhas deliberadas:
- Argon2id para hashing de senha (recomendação atual da OWASP, resistente a
  ataques por GPU/ASIC). Cada senha tem seu próprio salt automático.
- Access token de vida curta (15 min por padrão) + refresh token de vida
  mais longa guardado como cookie httpOnly (não acessível via JavaScript,
  o que reduz o risco de roubo por XSS) e com registro no banco para poder
  ser revogado (logout real, não só "esquecer" o token no cliente).
"""
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False


def create_access_token(subject: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "role": role, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def generate_refresh_token_raw() -> str:
    """Gera um token aleatório opaco (não é um JWT) para usar como refresh token.
    Só o hash dele é guardado no banco — assim, mesmo se o banco vazar, o
    token em si não pode ser reconstruído."""
    return secrets.token_urlsafe(48)


def hash_token(raw_token: str) -> str:
    import hashlib
    return hashlib.sha256(raw_token.encode()).hexdigest()
