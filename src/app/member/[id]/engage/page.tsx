import { EngagementHub } from "@/components/Workspace";

export const metadata = { title: "Care Engagement Hub | HiLabs Prism" };

export default async function EngagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ to?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  return <EngagementHub memberId={decodeURIComponent(id).toUpperCase()} initialTarget={query.to ?? null} />;
}
