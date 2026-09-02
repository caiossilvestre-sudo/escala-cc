import { useState } from "react";
import { TopBar, Pill, Spinner, ErrorBox, Toast, EditableSelect } from "../components/UI";
import { useApiList, useToast } from "../lib/hooks";
import { api } from "../api/client";
import { EQUIPES, ESCALAS, TURNOS } from "../lib/helpers";

function EquipeMultiSelect({ selecionadas, onChange, options }) {
  const alternar = (equipe) => {
    if (selecionadas.includes(equipe)) onChange(selecionadas.filter((e) => e !== equipe));
    else onChange([...selecionadas, equipe]);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
      {options.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Nenhum setor cadastrado ainda.</span>}
      {options.map((e) => (
        <label key={e} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, background: selecionadas.includes(e) ? "#F0F4FF" : "transparent", padding: "3px 8px", borderRadius: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={selecionadas.includes(e)} onChange={() => alternar(e)} /> {e}
        </label>
      ))}
    </div>
  );
}

function NovoColaboradorForm({ onCreated, showToast, equipeOptions, escalaOptions, turnoOptions, souSupervisor, minhasEquipes }) {
  const equipeInicial = souSupervisor ? (minhasEquipes[0] || "") : (equipeOptions[0] || EQUIPES[0]);
  const [form, setForm] = useState({
    nome: "", email: "", role: "colaborador", equipe: equipeInicial, equipes_gerenciadas: [],
    turno: turnoOptions[0] || TURNOS[0], escala_tipo: escalaOptions[0] || ESCALAS[0],
    horario_inicio: "08:00", horario_fim: "17:00", senha_inicial: "", data_admissao: "", data_aniversario: "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.nome.trim() || !form.email.trim() || form.senha_inicial.length < 10) {
      showToast("Preencha nome, e-mail e uma senha inicial com pelo menos 10 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, data_admissao: form.data_admissao || null, data_aniversario: form.data_aniversario || null };
      if (form.role !== "supervisor") delete payload.equipes_gerenciadas;
      await api.post("/colaboradores", payload);
      showToast("Colaborador cadastrado.");
      setForm({ ...form, nome: "", email: "", senha_inicial: "", data_admissao: "", data_aniversario: "" });
      onCreated();
    } catch (e) {
      showToast(e.message || "Erro ao cadastrar.");
    } finally {
      setBusy(false);
    }
  };

  const equipeOptionsPermitidas = souSupervisor ? minhasEquipes : equipeOptions;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title">Novo colaborador</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Horário padrão vale de segunda a sábado. Domingos e feriados só têm expediente via plantão. A senha inicial é provisória — o colaborador deve trocá-la no primeiro acesso. Admissão e aniversário são opcionais (não temos isso pra quem já estava cadastrado).
      </div>
      {!souSupervisor && form.role === "admin" && (
        <div className="info-box">Setor/turno/escala aqui são só dados de perfil — um administrador enxerga e gerencia todos os setores normalmente, isso não limita o acesso dele a nada.</div>
      )}
      {!souSupervisor && form.role === "visualizador" && (
        <div className="info-box">Perfil "Visualizador": enxerga todas as telas de administração, mas não consegue cadastrar, editar, aprovar ou excluir nada — acesso só de leitura.</div>
      )}
      {!souSupervisor && form.role === "supervisor" && (
        <div className="info-box">Perfil "Supervisor": gerencia colaboradores, plantões, folgas/férias e atestados — mas só dos setores marcados abaixo em "Setores gerenciados". Pode gerenciar mais de um setor. Não consegue alterar perfil de acesso de ninguém nem mexer em feriados — isso continua exclusivo do administrador.</div>
      )}
      <div className="form-grid">
        <div className="field"><label>Nome</label><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" /></div>
        <div className="field"><label>E-mail (login)</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="pessoa@empresa.com" /></div>
        {!souSupervisor && (
          <div className="field"><label>Perfil</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="colaborador">Colaborador</option>
              <option value="supervisor">Supervisor (gerencia setor(es) próprios)</option>
              <option value="visualizador">Visualizador (só leitura)</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        )}
        <div className="field"><label>Setor</label>
          {souSupervisor
            ? <select value={form.equipe} onChange={(e) => setForm({ ...form, equipe: e.target.value })}>{equipeOptionsPermitidas.map((e) => <option key={e}>{e}</option>)}</select>
            : <EditableSelect value={form.equipe} onChange={(v) => setForm({ ...form, equipe: v })} options={equipeOptions} placeholder="Nome do novo setor" />}
        </div>
        <div className="field"><label>Turno</label><EditableSelect value={form.turno} onChange={(v) => setForm({ ...form, turno: v })} options={turnoOptions} placeholder="Nome do novo turno" /></div>
        <div className="field"><label>Escala</label><EditableSelect value={form.escala_tipo} onChange={(v) => setForm({ ...form, escala_tipo: v })} options={escalaOptions} placeholder="ex: 5x1" /></div>
        <div className="field"><label>Início</label><input type="time" value={form.horario_inicio} onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} /></div>
        <div className="field"><label>Fim</label><input type="time" value={form.horario_fim} onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} /></div>
        <div className="field"><label>Senha inicial</label><input type="text" value={form.senha_inicial} onChange={(e) => setForm({ ...form, senha_inicial: e.target.value })} placeholder="mín. 10 caracteres" /></div>
        <div className="field"><label>Data de admissão (opcional)</label><input type="date" value={form.data_admissao} onChange={(e) => setForm({ ...form, data_admissao: e.target.value })} /></div>
        <div className="field"><label>Aniversário (opcional)</label><input type="date" value={form.data_aniversario} onChange={(e) => setForm({ ...form, data_aniversario: e.target.value })} /></div>
      </div>
      {!souSupervisor && form.role === "supervisor" && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Setores gerenciados (pode marcar mais de um)</label>
          <EquipeMultiSelect selecionadas={form.equipes_gerenciadas} onChange={(v) => setForm({ ...form, equipes_gerenciadas: v })} options={equipeOptions} />
        </div>
      )}
      <button className="btn btn-primary" disabled={busy} onClick={submit}>Cadastrar</button>
    </div>
  );
}

function EditarColaboradorRow({ colaborador, onDone, showToast, equipeOptions, escalaOptions, turnoOptions, souSupervisor, minhasEquipes }) {
  const [form, setForm] = useState({
    nome: colaborador.nome, role: colaborador.role, equipe: colaborador.equipe,
    equipes_gerenciadas: colaborador.equipes_gerenciadas || [],
    turno: colaborador.turno, escala_tipo: colaborador.escala_tipo,
    horario_inicio: colaborador.horario_inicio, horario_fim: colaborador.horario_fim,
    data_admissao: colaborador.data_admissao || "", data_aniversario: colaborador.data_aniversario || "",
    motivo: "",
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!form.motivo.trim()) { showToast("Informe o motivo da alteração."); return; }
    setBusy(true);
    try {
      const payload = { ...form, data_admissao: form.data_admissao || null, data_aniversario: form.data_aniversario || null };
      if (souSupervisor) { delete payload.role; delete payload.equipes_gerenciadas; }
      await api.patch(`/colaboradores/${colaborador.id}`, payload);
      showToast("Colaborador atualizado.");
      onDone();
    } catch (e) {
      showToast(e.message || "Erro ao atualizar.");
    } finally {
      setBusy(false);
    }
  };
  const equipeOptionsPermitidas = souSupervisor ? minhasEquipes : equipeOptions;
  return (
    <div style={{ marginTop: 8, padding: 12, background: "#FAFBFC", borderRadius: 8 }}>
      <div className="form-grid">
        <div className="field"><label>Nome</label><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
        {!souSupervisor && (
          <div className="field"><label>Perfil</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="colaborador">Colaborador</option>
              <option value="supervisor">Supervisor (gerencia setor(es) próprios)</option>
              <option value="visualizador">Visualizador (só leitura)</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        )}
        <div className="field"><label>Setor</label>
          {souSupervisor
            ? <select value={form.equipe} onChange={(e) => setForm({ ...form, equipe: e.target.value })}>{equipeOptionsPermitidas.map((e) => <option key={e}>{e}</option>)}</select>
            : <EditableSelect value={form.equipe} onChange={(v) => setForm({ ...form, equipe: v })} options={equipeOptions} />}
        </div>
        <div className="field"><label>Turno</label><EditableSelect value={form.turno} onChange={(v) => setForm({ ...form, turno: v })} options={turnoOptions} /></div>
        <div className="field"><label>Escala</label><EditableSelect value={form.escala_tipo} onChange={(v) => setForm({ ...form, escala_tipo: v })} options={escalaOptions} /></div>
        <div className="field"><label>Início</label><input type="time" value={form.horario_inicio} onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} /></div>
        <div className="field"><label>Fim</label><input type="time" value={form.horario_fim} onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} /></div>
        <div className="field"><label>Admissão (opcional)</label><input type="date" value={form.data_admissao} onChange={(e) => setForm({ ...form, data_admissao: e.target.value })} /></div>
        <div className="field"><label>Aniversário (opcional)</label><input type="date" value={form.data_aniversario} onChange={(e) => setForm({ ...form, data_aniversario: e.target.value })} /></div>
      </div>
      {!souSupervisor && form.role === "supervisor" && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Setores gerenciados</label>
          <EquipeMultiSelect selecionadas={form.equipes_gerenciadas} onChange={(v) => setForm({ ...form, equipes_gerenciadas: v })} options={equipeOptions} />
        </div>
      )}
      <div className="field" style={{ marginBottom: 10 }}><label>Motivo da alteração (obrigatório)</label><input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="ex: promovido a supervisor / mudou de setor" /></div>
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

function ResetarSenhaRow({ colaborador, onDone, showToast }) {
  const [novaSenha, setNovaSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (novaSenha.length < 10) { showToast("A senha precisa ter pelo menos 10 caracteres."); return; }
    setBusy(true);
    try {
      await api.post(`/colaboradores/${colaborador.id}/resetar-senha`, { nova_senha: novaSenha });
      showToast("Senha redefinida — o colaborador vai precisar trocá-la no próximo login.");
      onDone();
    } catch (e) {
      showToast(e.message || "Erro ao redefinir senha.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 8, padding: 10, background: "#FAFBFC", borderRadius: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 200 }}><label>Nova senha provisória</label><input type="text" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="mín. 10 caracteres" /></div>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>Redefinir senha</button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancelar</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>Isso também libera automaticamente qualquer bloqueio por tentativas erradas.</div>
    </div>
  );
}

export default function Colaboradores({ user }) {
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [filtroSetor, setFiltroSetor] = useState("Todos");
  const { data, loading, error, reload } = useApiList(`/colaboradores${incluirInativos ? "?incluir_inativos=true" : ""}`, [incluirInativos]);
  const { toast, showToast } = useToast();
  const [editandoId, setEditandoId] = useState(null);
  const [desligandoId, setDesligandoId] = useState(null);
  const [resetandoId, setResetandoId] = useState(null);

  const souSupervisor = user?.role === "supervisor";
  const minhasEquipes = souSupervisor ? (user.equipes_gerenciadas?.length ? user.equipes_gerenciadas : [user.equipe]) : [];

  // Só mostra setor/turno/escala que alguém realmente está usando agora —
  // assim que ninguém mais usa um valor, ele some sozinho da lista.
  const equipeOptions = Array.from(new Set(data.map((c) => c.equipe))).filter(Boolean);
  const turnoOptions = Array.from(new Set(data.map((c) => c.turno))).filter(Boolean);
  const escalaOptions = Array.from(new Set(data.map((c) => c.escala_tipo))).filter(Boolean);

  const dataFiltrada = filtroSetor === "Todos" ? data : data.filter((c) => c.equipe === filtroSetor);

  const ROLE_PILL_LABEL = { admin: "Admin", visualizador: "Visualizador", supervisor: "Supervisor" };

  const estaBloqueado = (c) => c.locked_until && new Date(c.locked_until + "Z") > new Date();

  const reativar = async (id) => {
    try {
      await api.post(`/colaboradores/${id}/reativar`);
      showToast("Colaborador reativado.");
      reload();
    } catch (e) { showToast(e.message); }
  };

  const desbloquear = async (id) => {
    try {
      await api.post(`/colaboradores/${id}/desbloquear`);
      showToast("Conta desbloqueada.");
      reload();
    } catch (e) { showToast(e.message); }
  };

  return (
    <>
      <TopBar title="Colaboradores" subtitle={souSupervisor ? `Cadastro de pessoas — setores: ${minhasEquipes.join(", ")}` : "Cadastro de pessoas, setor, turno e escala padrão"} />
      <div className="content">
        <ErrorBox error={error} />
        <NovoColaboradorForm onCreated={reload} showToast={showToast} equipeOptions={equipeOptions} escalaOptions={escalaOptions} turnoOptions={turnoOptions} souSupervisor={souSupervisor} minhasEquipes={minhasEquipes} />

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>Equipe ({dataFiltrada.length})</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 9px", fontSize: 12 }}>
                <option value="Todos">Todos os setores</option>
                {equipeOptions.map((e) => <option key={e}>{e}</option>)}
              </select>
              <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={incluirInativos} onChange={(e) => setIncluirInativos(e.target.checked)} /> Mostrar desligados
              </label>
            </div>
          </div>
          {loading ? <Spinner /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {dataFiltrada.map((c) => (
                <div key={c.id} style={{ borderBottom: "1px solid #EEF0F3", padding: "10px 4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <b>{c.nome}</b> <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{c.email}</span>
                      <div style={{ fontSize: 12, marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Pill status="plantao">{c.equipe}</Pill><Pill status="plantao">{c.turno}</Pill>
                        <span className="mono" style={{ color: "var(--text-muted)" }}>{c.escala_tipo} · {c.horario_inicio}–{c.horario_fim}</span>
                        {c.status === "inativo" && <Pill status="rejeitada">Desligado{c.data_desligamento ? ` em ${c.data_desligamento}` : ""}</Pill>}
                        {estaBloqueado(c) && <Pill status="rejeitada">🔒 Bloqueado até {new Date(c.locked_until + "Z").toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</Pill>}
                        {(c.role === "admin" || c.role === "visualizador" || c.role === "supervisor") && <Pill status="aprovada">{ROLE_PILL_LABEL[c.role]}{c.role === "supervisor" && c.equipes_gerenciadas?.length > 1 ? ` (${c.equipes_gerenciadas.length} setores)` : ""}</Pill>}
                      </div>
                    </div>
                    {c.status === "ativo" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {estaBloqueado(c) && <button className="btn btn-success btn-sm" onClick={() => desbloquear(c.id)}>Desbloquear</button>}
                        <button className="btn btn-ghost btn-sm" onClick={() => setResetandoId(resetandoId === c.id ? null : c.id)}>Redefinir senha</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditandoId(editandoId === c.id ? null : c.id)}>Editar</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDesligandoId(desligandoId === c.id ? null : c.id)}>Desligar</button>
                      </div>
                    ) : (
                      <button className="btn btn-success btn-sm" onClick={() => reativar(c.id)}>Reativar</button>
                    )}
                  </div>
                  {resetandoId === c.id && <ResetarSenhaRow colaborador={c} showToast={showToast} onDone={() => { setResetandoId(null); reload(); }} />}
                  {editandoId === c.id && (
                    <EditarColaboradorRow colaborador={c} showToast={showToast} equipeOptions={equipeOptions} escalaOptions={escalaOptions} turnoOptions={turnoOptions} souSupervisor={souSupervisor} minhasEquipes={minhasEquipes}
                      onDone={() => { setEditandoId(null); reload(); }} />
                  )}
                  {desligandoId === c.id && <DesligarRow colaborador={c} showToast={showToast} onDone={() => { setDesligandoId(null); reload(); }} />}
                </div>
              ))}
              {dataFiltrada.length === 0 && <div className="empty">Nenhum colaborador encontrado.</div>}
            </div>
          )}
        </div>
      </div>
      <Toast toast={toast} />
    </>
  );
}
