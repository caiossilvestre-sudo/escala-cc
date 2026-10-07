// Ponto de entrada do módulo Ferramentas para o App.jsx do Escala.
import { useEffect, useState } from "react";
import { api } from "../api/client";

export { default as LifeGuardDocumentacao } from "./Documentacao";
export { default as LifeGuardDiagnostico } from "./Diagnostico";

/** Grupo do menu lateral. Só aparece para quem tem acesso ao módulo. */
export const NAV_FERRAMENTAS = {
  grupo: "Ferramentas",
  itens: [
    { id: "lg-documentacao", label: "LifeGuard · Documentação" },
    { id: "lg-diagnostico", label: "LifeGuard · Diagnóstico" },
  ],
};

/** Nível da pessoa logada no módulo: null (sem acesso) | "n1" | "n2" | "admin". */
export function useFerramentasNivel(userId) {
  const [nivel, setNivel] = useState(null);
  useEffect(() => {
    if (!userId) { setNivel(null); return; }
    api.get("/ferramentas/me").then((r) => setNivel(r.nivel)).catch(() => setNivel(null));
  }, [userId]);
  return nivel;
}
