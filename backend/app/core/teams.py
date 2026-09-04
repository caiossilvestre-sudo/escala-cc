import json
import urllib.error
import urllib.request

from app.core.config import settings


def teams_configurado() -> bool:
    return bool(settings.power_automate_webhook_url)


def enviar_teams_aviso(destinatario_email: str, nome: str, tipo: str, mensagem: str) -> tuple[bool, str | None]:
    """Chama o webhook HTTP do Power Automate, que se encarrega de mandar a
    mensagem individual pra pessoa certa no Teams (usando o e-mail dela como
    identificador). Nunca levanta exceção — se não estiver configurado ou o
    fluxo falhar, a geração do aviso continua funcionando normalmente."""
    if not teams_configurado():
        return False, "Power Automate não configurado"

    payload = json.dumps({
        "email_destinatario": destinatario_email,
        "nome": nome,
        "tipo": tipo,
        "mensagem": mensagem,
    }).encode("utf-8")
    req = urllib.request.Request(
        settings.power_automate_webhook_url, data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
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
