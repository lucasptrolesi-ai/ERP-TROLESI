import { notFound } from "next/navigation";
import { buscarPedidoDetalhe } from "@/lib/buscar-pedido-detalhe";
import { CupomView } from "./cupom-view";

export default async function CupomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detalhe = await buscarPedidoDetalhe(id);
  if (!detalhe) notFound();

  return <CupomView pedido={detalhe.pedido} parcelas={detalhe.parcelas} />;
}
