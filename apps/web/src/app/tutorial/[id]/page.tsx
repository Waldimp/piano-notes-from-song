import Tutorial from "@/components/Tutorial";

export default async function TutorialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Tutorial id={id} />;
}
