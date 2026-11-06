import { QueueView } from "@/components/QueueView";
import { dataset } from "@/lib/data";

/**
 * The queue itself is fetched from /api/queue on the client. /api/queue does not return the
 * simulated alert, so only that field is passed from here: see docs/contract-gaps.md.
 */
export default function QueuePage() {
  return <QueueView simulatedAlert={dataset.simulatedAlert} />;
}
