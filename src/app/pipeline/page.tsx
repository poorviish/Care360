import { PipelineView } from "@/components/PipelineView";
import { dataset, report } from "@/lib/data";

export const metadata = { title: "Pipeline | HiLabs Prism" };

export default function PipelinePage() {
  const names = Object.fromEntries(dataset.members.map((m) => [m.id, String(m.name.value ?? m.id)]));
  return <PipelineView report={report} flags={dataset.flags} names={names} />;
}
