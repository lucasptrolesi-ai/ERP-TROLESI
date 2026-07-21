-- Achado do code-review (cross-file): condicoes_pagamento foi semeada
-- antes de "debito" existir como forma_pagamento (Fase 3) — nunca ganhou
-- linha própria. Hoje nenhuma regra em código consulta essa tabela pro
-- valor mínimo (o desconto automático de débito já está certo em
-- src/lib/desconto.ts), mas deixa a tabela consistente pra quando algo
-- passar a consultá-la.
--
-- ROLLBACK:
-- delete from public.condicoes_pagamento where forma_pagamento = 'debito';

insert into public.condicoes_pagamento (forma_pagamento, valor_minimo_venda, parcelas_maximas_sem_juros, parcelas_maximas_com_juros)
values ('debito', 0, 1, 1)
on conflict (forma_pagamento) do nothing;
