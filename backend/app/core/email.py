import smtplib
from email.mime.text import MIMEText

from app.core.config import settings

TIPO_ASSUNTO = {
    "mensal": "Sua lista de plantões do mês",
    "semanal": "Seus plantões desta semana",
    "cobranca": "Pendência: agendar folga de plantão",
    "aniversario": "Feliz aniversário! 🎉",
    "aniversario_trabalho": "Parabéns pelo tempo de casa! 🎊",
}


def smtp_configurado() -> bool:
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password and settings.smtp_from_email)


def enviar_email_aviso(destinatario_email: str, tipo: str, mensagem: str) -> tuple[bool, str | None]:
    """Envia o aviso por e-mail. Retorna (sucesso, mensagem_de_erro).
    Nunca levanta exceção — se o SMTP não estiver configurado ou o envio
    falhar, a geração do aviso no painel continua funcionando normalmente."""
    if not smtp_configurado():
        return False, "SMTP não configurado"

    assunto = TIPO_ASSUNTO.get(tipo, "Aviso do sistema")
    corpo = MIMEText(mensagem, "plain", "utf-8")
    corpo["Subject"] = f"[Escala Suporte Técnico] {assunto}"
    corpo["From"] = f"{settings.smtp_from_nome} <{settings.smtp_from_email}>"
    corpo["To"] = destinatario_email

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as servidor:
            servidor.starttls()
            servidor.login(settings.smtp_user, settings.smtp_password)
            servidor.sendmail(settings.smtp_from_email, [destinatario_email], corpo.as_string())
        return True, None
    except Exception as e:
        return False, str(e)
