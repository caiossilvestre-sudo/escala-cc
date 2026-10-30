import { TopBar } from "../components/UI";

/** Página reservada para uma ferramenta que ainda vai ser montada. */
export default function EmConstrucao({ titulo }) {
  return (
    <>
      <TopBar title={`Ferramentas · ${titulo}`} subtitle="Em construção" />
      <div className="content">
        <div className="card empty">🚧 Esta página ainda está sendo montada.</div>
      </div>
    </>
  );
}
