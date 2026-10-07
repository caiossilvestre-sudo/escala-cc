import { TopBar } from "../components/UI";

/** Página reservada do LifeGuard que ainda vai ser migrada do Console. */
export default function EmConstrucao({ titulo, sub }) {
  return (
    <>
      <TopBar title={`LifeGuard · ${titulo}`} subtitle={sub} />
      <div className="content">
        <div className="card">
          <div className="empty">Em construção — por enquanto esta parte continua no LifeGuard Console (LifeGuardHelper.exe).</div>
        </div>
      </div>
    </>
  );
}
