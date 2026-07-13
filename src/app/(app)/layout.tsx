import { AppShell } from "@/components/app-shell";
import { getPerfilAtual } from "@/lib/supabase/auth";

const PAPEL_LABEL: Record<string, string> = {
  admin: "Admin",
  vendedor: "Vendedor",
  financeiro: "Financeiro",
  estoque: "Estoque",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await getPerfilAtual();
  const papelLabel = PAPEL_LABEL[perfil.papel] ?? "Sem papel";
  const inicial = perfil.nome.charAt(0).toUpperCase();

  return (
    <AppShell nome={perfil.nome} papelLabel={papelLabel} inicial={inicial}>
      {children}
    </AppShell>
  );
}
