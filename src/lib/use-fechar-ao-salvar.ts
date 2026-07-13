import { useEffect, useRef } from "react";

/**
 * Server Action com useActionState não avisa "sucesso" diretamente — só dá
 * pra inferir observando a transição pending:true -> pending:false sem erro.
 * Centralizado aqui porque essa lógica é fácil de errar sutilmente (ex:
 * disparar no mount) se cada formulário reimplementar por conta própria.
 */
export function useFecharAoSalvar(pending: boolean, erro: string | undefined, aoSalvar: () => void) {
  const estavaPendente = useRef(false);

  useEffect(() => {
    if (estavaPendente.current && !pending && !erro) {
      aoSalvar();
    }
    estavaPendente.current = pending;
  }, [pending, erro, aoSalvar]);
}
