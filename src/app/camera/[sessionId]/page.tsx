import { CameraCelularView } from "./camera-celular-view";

export default async function CameraPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ prefixo?: string }>;
}) {
  const { sessionId } = await params;
  const { prefixo } = await searchParams;

  return (
    <CameraCelularView
      sessionId={sessionId}
      prefixo={prefixo === "evento" ? "evento" : "manual"}
    />
  );
}
