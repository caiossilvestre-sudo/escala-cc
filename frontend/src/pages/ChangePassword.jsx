import { useState } from "react";
import { TopBar } from "../components/UI";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function ChangePassword() {
  const { reloadUser } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErro(""); setOk(false);
    if (novaSenha !== confirmar) { setErro("As senhas não conferem."); return; }
    if (novaSenha.length < 10) { setErro("A nova senha precisa ter pelo menos 10 caracteres."); return; }
    setBusy(true);
    try {
      await api.post("/auth/change-password", { senha_atual: senhaAtual, nova_senha: novaSenha });
      setOk(true);
      setSenhaAtual(""); setNovaSenha(""); setConfirmar("");
      await reloadUser();
    } catch (e2) {
      setErro(e2.message || "Erro ao trocar senha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar title="Trocar senha" subtitle="Recomendado assim que você entrar pela primeira vez" />
      <div className="content">
        <form onSubmit={submit} className="card" style={{ maxWidth: 380 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Senha atual</label>
            <input type="password" required value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Nova senha (mín. 10 caracteres, letras e números)</label>
            <input type="password" required value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Confirmar nova senha</label>
            <input type="password" required value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
          </div>
          {erro && <div className="warn-box" style={{ background: "#FBE2E5", borderColor: "#F3C3CB", color: "#A32E42" }}>{erro}</div>}
          {ok && <div className="warn-box" style={{ background: "#DEF3E9", borderColor: "#BFE7CF", color: "#177A50" }}>Senha alterada com sucesso.</div>}
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Salvando…" : "Trocar senha"}</button>
        </form>
      </div>
    </>
  );
}
