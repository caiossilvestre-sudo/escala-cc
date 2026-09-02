import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox } from "../components/UI";
import { useApiList } from "../lib/hooks";
import { identificarCotaSindicato, cicloSindicatoAtual, prazoFolgaPlantao, todayISO, COTAS_SINDICATO } from "../lib/helpers";

export default function RelatorioEquipe() {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [setorFiltro, setSetorFiltro] = useState("Todos");
  const [buscaNome, setBuscaNome] = useState("");
  const colaboradores = useApiList("/colaboradores");
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const atestados = useApiList("/atestados");
  const feriados = useApiList("/feriados");

  const loading = colaboradores.loading || plantoes.loading || solicitacoes.loading || atestados.loading || feriados.loading;
  const error = colaboradores.error || plantoes.error || solicitacoes.error || atestados.error;

  const hoje = todayISO();
  const cicloAtual = cicloSindicatoAtual();

  const equipeCompleta = colaboradores.data.filter((c) => c.role === "colaborador" || c.role === "supervisor");
  const setoresDisponiveis = Array.from(new Set(equipeCompleta.map((c) => c.equipe))).filter(Boolean).sort();
  const equipe = equipeCompleta
    .filter((c) => setorFiltro === "Todos" || c.equipe === setorFiltro)
    .filter((c) => !buscaNome.trim() || c.nome.toLowerCase().includes(buscaNome.trim().toLowerCase()));

  const linhas = equipe.map((c) => {
    const meusPlantoes = plantoes.data.filter((p) => p.colaborador_id === c.id);
    const minhasSolicitacoes = solicitacoes.data.filter((s) => s.colaborador_id === c.id);
    const meusAtestados = atestados.data.filter((a) => a.colaborador_id === c.id);

    const plantoesNoAno = meusPlantoes.filter((p) => p.data.slice(0, 4) === String(ano));
    const folgasAprovadasNoAno = minhasSolicitacoes.filter((s) => s.status === "aprovada" && s.data_solicitada.slice(0, 4) === String(ano));
    const atestadosNoAno = meusAtestados.filter((a) => a.data_inicio.slice(0, 4) === String(ano));

    // Plantões sem folga vinculada ainda (considerando o prazo estendido de feriado)
    let atrasados = 0, aguardando = 0;
    for (const p of meusPlantoes) {
      const temSolicitacao = minhasSolicitacoes.some((s) => s.plantao_id === p.id && s.status !== "rejeitada");
      if (temSolicitacao) continue;
      const prazo = prazoFolgaPlantao(p.data, feriados.data);
      if (hoje > prazo) atrasados++;
      else aguardando++;
    }

    // Cotas de sindicato: usa a mesma lógica de janelas, mas só olha o ciclo atual
    const usadasPorCota = {};
    for (const s of minhasSolicitacoes) {
      if (s.tipo !== "folga_sindicato" || s.status === "rejeitada") continue;
      const cota = identificarCotaSindicato(s.data_solicitada);
      if (cota && cota.ciclo === cicloAtual) usadasPorCota[cota.nome] = true;
    }
    const totalUsadasSindicato = Object.keys(usadasPorCota).length;
    // Janela aberta AGORA que ainda não foi usada — vale um lembrete pro gestor.
    const cotaAberta = identificarCotaSindicato(hoje);
    const sindicatoPendente = cotaAberta && cotaAberta.ciclo === cicloAtual && !usadasPorCota[cotaAberta.nome];

    return {
      colaborador: c,
      plantoes: plantoesNoAno.length,
      folgas: folgasAprovadasNoAno.length,
      atestados: atestadosNoAno.length,
      sindicatoUsadas: totalUsadasSindicato,
      sindicatoPendente,
      cotaAbertaNome: cotaAberta?.nome,
      atrasados,
      aguardando,
    };
  }).sort((a, b) => (b.atrasados - a.atrasados) || a.colaborador.nome.localeCompare(b.colaborador.nome));

  const totalAtrasados = linhas.reduce((s, l) => s + l.atrasados, 0);
  const totalSindicatoPendente = linhas.filter((l) => l.sindicatoPendente).length;

  return (
    <>
      <TopBar title="Relatório da equipe" subtitle="Folgas, atestados, sindicato e pendências por colaborador"
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="text" placeholder="Buscar colaborador…" value={buscaNome} onChange={(e) => setBuscaNome(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, width: 170 }} />
            <select value={setorFiltro} onChange={(e) => setSetorFiltro(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }}>
              <option value="Todos">Todos os setores</option>
              {setoresDisponiveis.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value))} className="mono" style={{ width: 90, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }} />
          </div>
        } />
      <div className="content content-wide">
        <ErrorBox error={error} />
        {(totalAtrasados > 0 || totalSindicatoPendente > 0) && (
          <div className="warn-box">
            <span>
              {totalAtrasados > 0 && <>⚠️ {totalAtrasados} plantão(ões) no total, entre todo mundo, sem folga agendada e já fora do prazo. </>}
              {totalSindicatoPendente > 0 && <>🗓️ {totalSindicatoPendente} pessoa(s) com a janela de folga sindicato aberta agora e ainda não usada.</>}
            </span>
          </div>
        )}
        <div className="card">
          <div className="section-title">Por colaborador em {ano} (ciclo sindicato {cicloAtual})</div>
          {loading ? <Spinner /> : linhas.length === 0 ? <div className="empty">Nenhum colaborador encontrado.</div> : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nome</th><th>Setor</th><th>Plantões</th><th>Folgas aprovadas</th><th>Atestados</th>
                  <th>Sindicato usado</th><th>Folga de plantão pendente</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.colaborador.id}>
                    <td>{l.colaborador.nome}</td>
                    <td><Pill status="plantao">{l.colaborador.equipe}</Pill></td>
                    <td className="mono">{l.plantoes}</td>
                    <td className="mono">{l.folgas}</td>
                    <td className="mono">{l.atestados}</td>
                    <td>
                      <span className="mono">{l.sindicatoUsadas}/{COTAS_SINDICATO.length}</span>
                      {l.sindicatoPendente && <Pill status="pendente" style={{ marginLeft: 6 }}>Janela "{l.cotaAbertaNome}" aberta</Pill>}
                    </td>
                    <td>
                      {l.atrasados === 0 && l.aguardando === 0 && <span style={{ color: "var(--text-muted)" }}>—</span>}
                      {l.atrasados > 0 && <Pill status="rejeitada">{l.atrasados} atrasado(s)</Pill>}
                      {l.aguardando > 0 && <Pill status="pendente" style={{ marginLeft: l.atrasados > 0 ? 6 : 0 }}>{l.aguardando} no prazo</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
