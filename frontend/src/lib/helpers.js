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
