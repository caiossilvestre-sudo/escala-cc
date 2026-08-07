import { useState } from "react";
import { TopBar, Spinner, ErrorBox, CronogramaGrid } from "../components/UI";
import { useApiList } from "../lib/hooks";
import { currentMonthKey } from "../lib/helpers";

export default function CronogramaEquipe({ user }) {
  const [mes, setMes] = useState(currentMonthKey());
  const colaboradores = useApiList("/colaboradores");
  const plantoes = useApiList("/plantoes");
  const solicitacoes = useApiList("/solicitacoes");
  const atestados = useApiList("/atestados");
  const ferias = useApiList("/ferias");

  const loading = colaboradores.loading || plantoes.loading;
  const daEquipe = colaboradores.data.filter((c) => c.equipe === user.equipe);

  return (
    <>
      <TopBar title="Cronograma do setor" subtitle={`Visão mensal da equipe ${user.equipe || ""}`} />
      <div className="content">
        <ErrorBox error={colaboradores.error} />
        {loading ? <Spinner /> : (
          <CronogramaGrid
            colaboradores={daEquipe} plantoes={plantoes.data} solicitacoes={solicitacoes.data}
            atestados={atestados.data} ferias={ferias.data}
            mesFiltro={mes} setMesFiltro={setMes} equipeFiltro={user.equipe} setEquipeFiltro={() => {}}
            equipesOptions={[]} showEquipeSelector={false}
          />
        )}
      </div>
    </>
  );
}
