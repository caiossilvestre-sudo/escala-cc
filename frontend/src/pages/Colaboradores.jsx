import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast, EditableSelect } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { EQUIPES, ESCALAS, TURNOS } from "../lib/helpers";

function NovoColaboradorForm({ onCreated, showToast, equipeOptions, escalaOptions, turnoOptions }) {
  const [form, setForm] = useState({ nome: "", email: "", role: "colaborador", equipe: EQUIPES[0], turno: TURNOS[0], escala_tipo: ESCALAS[0], horario_inicio: "08:00", horario_fim: "17:00", senha_inicial: "" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.nome.trim() || !form.email.trim() || form.senha_inicial.length < 10) {
      showToast("Preencha nome, e-mail e uma senha inicial com pelo menos 10 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/colaboradores", form);
      showToast("Colaborador cadastrado.");
      setForm({ ...form, nome: "", email: "", senha_inicial: "" });
      onCreated();
    } catch (e) {
      showToast(e.message || "Erro ao cadastrar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">Novo colaborador</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Horário padrão vale de segunda a sábado. Domingos e feriados só têm expediente via plantão. A senha inicial é provisória — o colaborador deve trocá-la no primeiro acesso. Não tem o setor ou a escala que você precisa na lista? Escolha "+ Adicionar novo…".
      </div>
      {form.role === "admin" && (
        <div className="info-box">Setor/turno/escala aqui são só dados de perfil — um administrador enxerga e gerencia todos os setores normalmente, isso não limita o acesso dele a nada.</div>
      )}
      <div className="form-grid">
        <div className="field"><label>Nome</label><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" /></div>
        <div className="field"><label>E-mail (login)</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="pessoa@empresa.com" /></div>
        <div className="field"><label>Perfil</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="colaborador">Colaborador</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div className="field"><label>Setor</label><EditableSelect value={form.equipe} onChange={(v) => setForm({ ...form, equipe: v })} options={equipeOptions} placeholder="Nome do novo setor" /></div>
        <div className="field"><label>Turno</label><EditableSelect value={form.turno} onChange={(v) => setForm({ ...form, turno: v })} options={turnoOptions} placeholder="Nome do novo turno" /></div>
        <div className="field"><label>Escala</label><EditableSelect value={form.escala_tipo} onChange={(v) => setForm({ ...form, escala_tipo: v })} options={escalaOptions} placeholder="ex: 5x1" /></div>
        <div className="field"><label>Início</label><input type="time" value={form.horario_inicio} onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} /></div>
        <div className="field"><label>Fim</label><input type="time" value={form.horario_fim} onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} /></div>
        <div className="field"><label>Senha inicial</label><input type="text" value={form.senha_inicial} onChange={(e) => setForm({ ...form, senha_inicial: e.target.value })} placeholder="mín. 10 caracteres" /></div>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={submit}>Cadastrar</button>
    </div>
  );
}

function EditarColaboradorRow({ colaborador, onDone, showToast, equipeOptions, escalaOptions, turnoOptions }) {
  const [form, setForm] = useState({
    nome: colaborador.nome, role: colaborador.role, equipe: colaborador.equipe, turno: colaborador.turno,
    escala_tipo: colaborador.escala_tipo, horario_inicio: colaborador.horario_inicio, horario_fim: colaborador.horario_fim, motivo: "",
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!form.motivo.trim()) { showToast("Informe o motivo da alteração."); return; }
    setBusy(true);
    try {
      await api.patch(`/colaboradores/${colaborador.id}`, form);
      showToast("Colaborador atualizado.");
      onDone();
    } catch (e) {
      showToast(e.message || "Erro ao atualizar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 8, padding: 12, background: "#FAFBFC", borderRadius: 8 }}>
      <div className="form-grid">
        <div className="field"><label>Nome</label><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
        <div className="field"><label>Perfil</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="colaborador">Colaborador</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div className="field"><label>Setor</label><EditableSelect value={form.equipe} onChange={(v) => setForm({ ...form, equipe: v })} options={equipeOptions} /></div>
        <div className="field"><label>Turno</label><EditableSelect value={form.turno} onChange={(v) => setForm({ ...form, turno: v })} options={turnoOptions} /></div>
        <div className="field"><label>Escala</label><EditableSelect value={form.escala_tipo} onChange={(v) => setForm({ ...form, escala_tipo: v })} options={escalaOptions} /></div>
        <div className="field"><label>Início</label><input type="time" value={form.horario_inicio} onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} /></div>
        <div className="field"><label>Fim</label><input type="time" value={form.horario_fim} onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} /></div>
      </div>
      <div className="field" style={{ marginBottom: 10 }}><label>Motivo da alteração (obrigatório)</label><input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="ex: promovido a administrador / reforço de N2 por demanda" /></div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>Salvar alterações</button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancelar</button>
      </div>
    </div>
  );
}

function DesligarRow({ colaborador, onDone, showToast }) {
  const [motivo, setMotivo] = useState("");
  const [pendencias, setPendencias] = useState(null);
  const [busy, setBusy] = useState(false);

  const carregarPendencias = async () => {
    try {
      const r = await api.get(`/colaboradores/${colaborador.id}/pendencias-desligamento`);
      setPendencias(r);
    } catch (e) { showToast(e.message); }
  };
  if (pendencias === null) { carregarPendencias(); return <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Verificando pendências…</div>; }

  const confirmar = async () => {
    if (!motivo.trim()) { showToast("Informe o motivo do desligamento."); return; }
    setBusy(true);
    try {
      await api.post(`/colaboradores/${colaborador.id}/desligar`, { motivo });
      showToast("Colaborador desligado. Histórico preservado.");
      onDone();
    } catch (e) {
      showToast(e.message || "Erro ao desligar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8, padding: 10, background: "#FFF6E8", borderRadius: 8, border: "1px solid #F2D8A0" }}>
      {(pendencias.plantoes_futuros.length > 0 || pendencias.folgas_pendentes > 0 || pendencias.ferias_em_andamento > 0) ? (
        <div style={{ fontSize: 12, color: "#8A5E10", marginBottom: 8 }}>
          Atenção: {pendencias.plantoes_futuros.length} plantão(ões) futuro(s), {pendencias.folgas_pendentes} folga(s) pendente(s) e {pendencias.ferias_em_andamento} férias em andamento vão precisar de atenção depois do desligamento.
          {pendencias.plantoes_futuros.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {pendencias.plantoes_futuros.map((p) => <li key={p.id}>{p.data} — {p.horario} ({p.tipo})</li>)}
            </ul>
          )}
        </div>
      ) : <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Sem plantões futuros ou solicitações em aberto.</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 180 }}><label>Motivo do desligamento</label><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex: pedido de demissão" /></div>
        <button className="btn btn-danger btn-sm" disabled={busy} onClick={confirmar}>Confirmar desligamento</button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancelar</button>
      </div>
    </div>
  );
}

export default function Colaboradores() {
  const [incluirInativos, setIncluirInativos] = useState(false);
  const { data, loading, error, reload } = useApiList(`/colaboradores${incluirInativos ? "?incluir_inativos=true" : ""}`, [incluirInativos]);
  const { toast, showToast } = useToast();
  const [editandoId, setEditandoId] = useState(null);
  const [desligandoId, setDesligandoId] = useState(null);

  // Setores/turnos/escalas disponíveis = os padrões + qualquer valor customizado já usado por alguém.
  const equipeOptions = Array.from(new Set([...EQUIPES, ...data.map((c) => c.equipe)])).filter(Boolean);
  const turnoOptions = Array.from(new Set([...TURNOS, ...data.map((c) => c.turno)])).filter(Boolean);
  const escalaOptions = Array.from(new Set([...ESCALAS, ...data.map((c) => c.escala_tipo)])).filter(Boolean);

  const reativar = async (id) => {
    try {
      await api.post(`/colaboradores/${id}/reativar`);
      showToast("Colaborador reativado.");
      reload();
    } catch (e) { showToast(e.message); }
  };

  return (
    <>
      <TopBar title="Colaboradores" subtitle="Cadastro de pessoas, setor, turno e escala padrão" />
      <div className="content">
        <ErrorBox error={error} />
        <NovoColaboradorForm onCreated={reload} showToast={showToast} equipeOptions={equipeOptions} escalaOptions={escalaOptions} turnoOptions={turnoOptions} />

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="section-title" style={{ margin: 0 }}>Equipe ({data.length})</div>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={incluirInativos} onChange={(e) => setIncluirInativos(e.target.checked)} /> Mostrar desligados
            </label>
          </div>
          {loading ? <Spinner /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {data.map((c) => (
                <div key={c.id} style={{ borderBottom: "1px solid #EEF0F3", padding: "10px 4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <b>{c.nome}</b> <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{c.email}</span>
                      <div style={{ fontSize: 12, marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Pill status="plantao">{c.equipe}</Pill><Pill status="plantao">{c.turno}</Pill>
                        <span className="mono" style={{ color: "var(--text-muted)" }}>{c.escala_tipo} · {c.horario_inicio}–{c.horario_fim}</span>
                        {c.status === "inativo" && <Pill status="rejeitada">Desligado{c.data_desligamento ? ` em ${c.data_desligamento}` : ""}</Pill>}
                        {c.role === "admin" && <Pill status="aprovada">Admin</Pill>}
                      </div>
                    </div>
                    {c.status === "ativo" ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditandoId(editandoId === c.id ? null : c.id)}>Editar</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDesligandoId(desligandoId === c.id ? null : c.id)}>Desligar</button>
                      </div>
                    ) : (
                      <button className="btn btn-success btn-sm" onClick={() => reativar(c.id)}>Reativar</button>
                    )}
                  </div>
                  {editandoId === c.id && (
                    <EditarColaboradorRow colaborador={c} showToast={showToast} equipeOptions={equipeOptions} escalaOptions={escalaOptions} turnoOptions={turnoOptions}
                      onDone={() => { setEditandoId(null); reload(); }} />
                  )}
                  {desligandoId === c.id && <DesligarRow colaborador={c} showToast={showToast} onDone={() => { setDesligandoId(null); reload(); }} />}
                </div>
              ))}
              {data.length === 0 && <div className="empty">Nenhum colaborador encontrado.</div>}
            </div>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
