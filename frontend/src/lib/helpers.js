export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function weekdayAbbrev(dateStr) {
  return WEEKDAYS[new Date(dateStr + "T00:00:00").getDay()];
}
export function formatBR(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}
export function formatBRDia(dateStr) {
  if (!dateStr) return "—";
  return `${formatBR(dateStr)} · ${weekdayAbbrev(dateStr)}`;
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
export function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
export function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function currentMonthKey() {
  return todayISO().slice(0, 7);
}
export function rangeOverlapsDate(dateStr, ini, fim) {
  return dateStr >= ini && dateStr <= fim;
}
export function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export const COTAS_SINDICATO = [
  { nome: "Maio", mesIni: 5, diaIni: 1, mesFim: 8, diaFim: 31 },
  { nome: "Agosto", mesIni: 8, diaIni: 1, mesFim: 10, diaFim: 31 },
  { nome: "Outubro", mesIni: 10, diaIni: 1, mesFim: 11, diaFim: 30 },
  { nome: "Dezembro", mesIni: 12, diaIni: 1, mesFim: 2, diaFim: 28 },
];

function ultimoDiaMes(ano, mes) {
  return new Date(ano, mes, 0).getDate();
}

/** Espelha app/logic.py::identificar_cota_sindicato — mesma regra, mesmo resultado. */
export function identificarCotaSindicato(dataStr) {
  const d = new Date(dataStr + "T00:00:00");
  const ano = d.getFullYear();
  for (const cota of COTAS_SINDICATO) {
    const cruzaAno = cota.mesFim < cota.mesIni;
    if (!cruzaAno) {
      const ini = new Date(ano, cota.mesIni - 1, cota.diaIni);
      const fim = new Date(ano, cota.mesFim - 1, Math.min(cota.diaFim, ultimoDiaMes(ano, cota.mesFim)));
      if (d >= ini && d <= fim) return { nome: cota.nome, ciclo: ano };
    } else {
      const ini1 = new Date(ano, cota.mesIni - 1, cota.diaIni);
      const fim1 = new Date(ano + 1, cota.mesFim - 1, Math.min(cota.diaFim, ultimoDiaMes(ano + 1, cota.mesFim)));
      if (d >= ini1 && d <= fim1) return { nome: cota.nome, ciclo: ano };
      const ini2 = new Date(ano - 1, cota.mesIni - 1, cota.diaIni);
      const fim2 = new Date(ano, cota.mesFim - 1, Math.min(cota.diaFim, ultimoDiaMes(ano, cota.mesFim)));
      if (d >= ini2 && d <= fim2) return { nome: cota.nome, ciclo: ano - 1 };
    }
  }
  return null;
}

export function cicloSindicatoAtual(hoje = new Date()) {
  const mes = hoje.getMonth() + 1;
  return mes <= 2 ? hoje.getFullYear() - 1 : hoje.getFullYear();
}

/** Espelha app/logic.py::prazo_folga_plantao — 6 dias corridos, ou até o
 * domingo da semana seguinte se o plantão foi num feriado. */
export function prazoFolgaPlantao(dataPlantaoStr, feriados) {
  const ehFeriado = feriados.some((f) => f.data === dataPlantaoStr);
  if (ehFeriado) {
    const d = new Date(dataPlantaoStr + "T00:00:00");
    const diasAteDomingo = (7 - d.getDay()) % 7;
    const domingoAtual = addDays(dataPlantaoStr, diasAteDomingo);
    return addDays(domingoAtual, 7);
  }
  return addDays(dataPlantaoStr, 6);
}

export const TIPO_LABEL = { folga_plantao: "Folga de plantão", folga_sindicato: "Folga normal (sindicato)" };

/** Determina o que mostrar numa célula do cronograma para um colaborador+dia. */
export function eventoDoDia(colaboradorId, dateStr, plantoes, solicitacoes, atestados, ferias, colaboradoresById, feriadosPorData) {
  const plantao = plantoes.find((p) => p.colaborador_id === colaboradorId && p.data === dateStr);
  if (plantao) {
    return { label: "P", bg: "#DCE8FB", fg: "#1E4FA0", title: `Plantão ${plantao.horario_inicio}–${plantao.horario_fim} (${plantao.tipo || ""})` };
  }
  const feriasHit = ferias.find((f) => f.colaborador_id === colaboradorId && f.status === "aprovada" && rangeOverlapsDate(dateStr, f.data_inicio, f.data_fim));
  if (feriasHit) return { label: "FÉR", bg: "#E4E5E8", fg: "#4B4F58", title: "Férias" };
  const folga = solicitacoes.find((s) => s.colaborador_id === colaboradorId && s.status === "aprovada" && s.data_solicitada === dateStr);
  if (folga && folga.tipo === "folga_sindicato") return { label: "F", bg: "#F6D6DA", fg: "#8A1F30", title: "Folga normal (sindicato)" };
  if (folga) return { label: "f", bg: "#FBE3E5", fg: "#B23A4C", title: TIPO_LABEL[folga.tipo] };
  const atestado = atestados.find((a) => a.colaborador_id === colaboradorId && rangeOverlapsDate(dateStr, a.data_inicio, a.data_fim));
  if (atestado) return { label: "AT", bg: "#FCEEDC", fg: "#9A5F14", title: "Atestado" };
  const feriado = feriadosPorData ? feriadosPorData[dateStr] : null;
  if (feriado) return { label: "F", bg: "#EAECEF", fg: "#5B5F6B", title: `Feriado: ${feriado.nome} — sem plantão neste dia` };
  return null;
}

export function mapaFeriadosPorData(feriados) {
  const mapa = {};
  (feriados || []).forEach((f) => {
    if (f.tipo === "obrigatorio" || f.trabalha) mapa[f.data] = f;
  });
  return mapa;
}

export const EQUIPES = ["Suporte N1", "Suporte N2", "Monitoramento"];
export const ESCALAS = ["6x2", "5x2", "12x36", "4x2"];
export const TURNOS = ["Manhã", "Tarde", "Noite", "Madrugada", "Supervisor"];

export function checarElegibilidade(colaborador, criterio, plantoes, ferias, atestados, solicitacoes) {
  const motivos = [];
  if (colaborador.equipe !== criterio.equipe) motivos.push("Setor diferente do solicitado");
  if (ferias.some((f) => f.colaborador_id === colaborador.id && f.status === "aprovada" && rangeOverlapsDate(criterio.data, f.data_inicio, f.data_fim))) motivos.push("Em férias aprovadas nesta data");
  if (atestados.some((a) => a.colaborador_id === colaborador.id && rangeOverlapsDate(criterio.data, a.data_inicio, a.data_fim))) motivos.push("Atestado nesta data");
  if (solicitacoes.some((s) => s.colaborador_id === colaborador.id && s.status === "aprovada" && s.data_solicitada === criterio.data)) motivos.push("Folga aprovada nesta data");
  if (plantoes.some((p) => p.colaborador_id === colaborador.id && p.data === criterio.data && timesOverlap(p.horario_inicio, p.horario_fim, criterio.horario_inicio, criterio.horario_fim))) motivos.push("Já tem plantão nesse horário");
  return { elegivel: motivos.length === 0, motivos };
}
function contarPlantoesRecentes(colaboradorId, plantoes, refDate, janelaDias = 60) {
  const limite = addDays(refDate, -janelaDias);
  return plantoes.filter((p) => p.colaborador_id === colaboradorId && p.data < refDate && p.data >= limite).length;
}
function diasDesdeUltimoPlantao(colaboradorId, plantoes, refDate) {
  const anteriores = plantoes.filter((p) => p.colaborador_id === colaboradorId && p.data < refDate).map((p) => p.data).sort();
  if (anteriores.length === 0) return Infinity;
  return (new Date(refDate + "T00:00:00") - new Date(anteriores[anteriores.length - 1] + "T00:00:00")) / 86400000;
}
export function ordenarPorJustica(elegiveis, plantoes, refDate) {
  return [...elegiveis].sort((a, b) => {
    const ca = contarPlantoesRecentes(a.colaborador.id, plantoes, refDate);
    const cb = contarPlantoesRecentes(b.colaborador.id, plantoes, refDate);
    if (ca !== cb) return ca - cb;
    return diasDesdeUltimoPlantao(b.colaborador.id, plantoes, refDate) - diasDesdeUltimoPlantao(a.colaborador.id, plantoes, refDate);
  });
}
export { contarPlantoesRecentes };
