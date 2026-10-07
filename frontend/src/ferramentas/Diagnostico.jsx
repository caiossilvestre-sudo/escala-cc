import { TopBar } from "../components/UI";

/** Lugar reservado para o diagnóstico do LifeGuard dentro do Escala. */
export default function Diagnostico() {
  return (
    <>
      <TopBar title="LifeGuard · Diagnóstico" subtitle="Testes de câmera, rede e provisionamento" />
      <div className="content">
        <div className="card">
          <div className="empty">Em construção — por enquanto o diagnóstico continua no LifeGuard instalado no computador.</div>
        </div>
      </div>
    </>
  );
}
