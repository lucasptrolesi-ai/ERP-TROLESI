import { getPerfilAtual } from "@/lib/supabase/auth";

export default async function DashboardPage() {
  const perfil = await getPerfilAtual();

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-2xl font-semibold text-ink">
        Bem-vindo(a), {perfil.nome}
      </h1>
      <p className="text-sm text-text-soft">
        Login e autenticação funcionando. Os módulos (Cadastros, Estoque, Pedidos, Financeiro,
        Fiscal) chegam na Fase 4, um de cada vez.
      </p>
    </div>
  );
}
