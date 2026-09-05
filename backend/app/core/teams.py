import json
import time
import urllib.error
import urllib.request

from app.core.config import settings

# Cache simples do token em memória — evita pedir um token novo a cada
# aviso; um token do Entra ID normalmente vale 1h.
_token_cache = {"valor": None, "expira_em": 0}


def teams_configurado() -> bool:
    return bool(settings.power_automate_webhook_url and settings.azure_tenant_id and settings.azure_client_id and settings.azure_client_secret)


def _obter_token() -> tuple[str | None, str | None]:
    """Pede um token OAuth (client_credentials) pro Entra ID, com cache
    simples em memória. Retorna (token, erro)."""
    agora = time.time()
    if _token_cache["valor"] and agora < _token_cache["expira_em"]:
        return _token_cache["valor"], None

    url = f"https://login.microsoftonline.com/{settings.azure_tenant_id}/oauth2/v2.0/token"
    corpo = (
        f"grant_type=client_credentials"
        f"&client_id={settings.azure_client_id}"
        f"&client_secret={settings.azure_client_secret}"
        f"&scope=https://service.flow.microsoft.com//.default"
    ).encode("utf-8")
    req = urllib.request.Request(url, data=corpo, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            dados = json.loads(resp.read().decode())
        token = dados.get("access_token")
        if not token:
            return None, "Resposta do Entra ID não trouxe access_token"
        _token_cache["valor"] = token
        _token_cache["expira_em"] = agora + int(dados.get("expires_in", 3600)) - 60  # renova 1 min antes de expirar
        return token, None
    except urllib.error.HTTPError as e:
        return None, f"Erro ao obter token OAuth: HTTP {e.code}: {e.read().decode(errors='ignore')[:300]}"
    except Exception as e:
        return None, f"Erro ao obter token OAuth: {e}"


def enviar_teams_aviso(destinatario_email: str, nome: str, tipo: str, mensagem: str) -> tuple[bool, str | None]:
    """Chama o webhook HTTP do Power Automate (autenticado com OAuth, como a
    Microsoft passou a exigir desde nov/2025), que se encarrega de mandar a
    mensagem individual pra pessoa certa no Teams. Nunca levanta exceção —
    se não estiver configurado ou algo falhar, a geração do aviso continua
    funcionando normalmente."""
    if not teams_configurado():
        return False, "Power Automate / Azure AD não configurados"

    token, erro = _obter_token()
    if erro:
        return False, erro

    payload = json.dumps({
        "email_destinatario": destinatario_email,
        "nome": nome,
        "tipo": tipo,
        "mensagem": mensagem,
    }).encode("utf-8")
    req = urllib.request.Request(
        settings.power_automate_webhook_url, data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status >= 400:
                return False, f"HTTP {resp.status}"
        return True, None
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode(errors='ignore')[:200]}"
    except Exception as e:
        return False, str(e)
