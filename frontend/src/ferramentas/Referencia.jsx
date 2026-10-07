import { TopBar, Pill } from "../components/UI";
import { MARCAS } from "./marcas";
import "./ferramentas.css";

/** LifeGuard · Referência técnica (consulta rápida). */
export default function Referencia() {
  return (
    <>
      <TopBar title="LifeGuard · Referência" subtitle="Protocolo, portas padrão por marca e faixas de bitrate/fps recomendadas" />
      <div className="content">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">RTSP × RTMP</div>
          <div className="ft-tabela-wrap">
            <table className="tbl">
              <thead><tr><th>Critério</th><th>RTSP</th><th>RTMP</th></tr></thead>
              <tbody>
                <tr><td>IP fixo</td><td>Obrigatório</td><td>Não necessário</td></tr>
                <tr><td>Redirecionamento</td><td>Porta 554 obrigatória</td><td>Não necessário</td></tr>
                <tr><td>Configuração</td><td>Mais complexa</td><td>Simplificada</td></tr>
                <tr><td>Estabilidade</td><td>Muito estável</td><td>Estável</td></tr>
                <tr><td>Áudio bidirecional</td><td>Limitado</td><td>Suportado nativamente</td></tr>
                <tr><td>Marcas compatíveis</td><td>Intelbras, TP-Link, Hikvision</td><td>Hikvision (modelos específicos, MAC iniciando <span className="mono">e0:ca</span>)</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Portas por marca (após correção)</div>
          <p style={{ margin: "-6px 0 12px", fontSize: 12, color: "var(--text-muted)" }}>Padrão a ser aplicado na câmera — porta WAN no roteador sempre sequencial a partir de 6000.</p>
          <div className="ft-tabela-wrap">
            <table className="tbl">
              <thead><tr><th>Marca</th><th>Porta RTSP da câmera</th><th>Porta teste redirecionamento</th><th>Protocolo no BackOffice</th><th>Caminho RTSP</th></tr></thead>
              <tbody>
                {Object.entries(MARCAS).map(([k, m]) => (
                  <tr key={k}>
                    <td style={{ fontWeight: 600 }}>{m.label}</td>
                    <td className="mono">554</td>
                    <td className="mono">{m.testPort}</td>
                    <td>
                      <Pill status="plantao">RTSP ({m.label})</Pill>
                      {k === "hikvision" && <> <Pill status="atestado">RTMP</Pill></>}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{m.rtspPath}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="info-box">Datas/hora: Intelbras não precisa de ajuste manual. Hikvision e TP-Link exigem conferir o fuso (GMT-03:00) Brasília nas configurações de sistema.</div>

        <div className="ft-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {Object.entries(MARCAS).map(([k, m]) => (
            <div key={k} className="card">
              <div className="section-title">{m.label}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                {m.notas.map((n) => <li key={n}>{n}</li>)}
              </ul>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginTop: 12 }}>Stream</div>
              <div style={{ fontSize: 12.5 }}>{m.bitrate}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginTop: 10 }}>Habilitar ONVIF</div>
              <div style={{ fontSize: 12.5 }}>{m.onvif}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
