import { MemberView } from "@/components/MemberView";

export const metadata = { title: "Member Insight Hub | HiLabs Prism" };

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MemberView memberId={decodeURIComponent(id).toUpperCase()} />;
}
