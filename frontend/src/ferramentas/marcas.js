// Dados técnicos por marca (vindos do LifeGuard Console, PG-ST077 v002).
// Usados na Referência e, depois, no Provisionamento/Diagnóstico.
// SEM credenciais aqui: senhas padrão ficam só no servidor (.env).

export const MARCAS = {
  intelbras: {
    label: "Intelbras",
    rtspPath: "/cam/realmonitor?channel=1&subtype=0",
    testPort: 80,
    notas: [
      "Login padrão de fábrica: admin + senha do cliente.",
      "Se a Porta RTSP estiver como 6000/6001…, altere para 554 em Configurações → Rede → Guardar.",
      "Data/hora: não precisa ajustar — vem correta automaticamente.",
    ],
    bitrate: "Stream principal 1024 kb/s (1920×1080, 15 fps) · Stream extra 512 kb/s (704×480, 15 fps)",
    onvif: "Configurações → Rede → ONVIF (ou \"Integração/Plataforma\") — habilite e confirme a porta (geralmente 80 ou 8080).",
  },
  hikvision: {
    label: "Hikvision",
    rtspPath: "/Streaming/Channels/101",
    testPort: 80,
    notas: [
      "Se a Porta RTSP estiver como 6000/6001…, altere para 554 em Configuração → Rede → Config. básicas → Porta.",
      "Confira o fuso horário em Configuração → Definições do sistema → Config. tempo → (GMT-03:00) Brasília.",
      "Confira o formato de data em Configuração → Imagem → Config. OSD → Menu formato de data → DD/MM/AAAA.",
      "Para RTMP: verifique se o MAC address da câmera começa com e0:ca (indica compatibilidade).",
    ],
    bitrate: "RTSP: ajustar conforme padrão do cliente · RTMP: manter entre 900–1100 kb/s",
    onvif: "Configuração → Rede → Avançado → Integração de Plataforma / ONVIF — habilite o protocolo e confira se pede um usuário ONVIF separado do admin.",
  },
  tplink: {
    label: "TP-Link",
    rtspPath: "/stream1",
    testPort: 443,
    notas: [
      "No redirecionamento de teste, use a porta 443 (não 80) em \"LAN Host Port\".",
      "Se a Porta RTSP estiver diferente de 554, corrija em Settings → Network Settings → Port → RTSP.",
      "Chrome pode ficar lento acessando a câmera — prefira o Firefox.",
      "Confira o fuso horário em Settings → System Settings → Basic Settings → Date → Brasília, São Paulo.",
    ],
    bitrate: "Padrão: 1920×1080, 15 fps, CBR, Max Bit Rate 1024 kbps",
    onvif: "Settings → Network Settings → procure por ONVIF; em modelos VIGI costuma vir habilitado, às vezes em porta diferente (ex: 2020).",
  },
};
