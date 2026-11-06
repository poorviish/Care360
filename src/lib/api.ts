import type { DemoFixture, MemberRecord, QualityFlag, QueueRow } from "@lib/pipeline/types";

/**
 * The typed API client. Relative URLs only, so it deploys unchanged. The response shapes mirror the
 * route handlers in src/app/api, and every entity type comes from the pipeline's published types.
 */

export interface QueueResponse {
  asOf: string;
  asOfSource: string;
  queue: QueueRow[];
}

export interface MemberResponse {
  asOf: string;
  member: MemberRecord;
  flags: QualityFlag[];
  /** The workspace content. The brief's /workspace route does not exist: see docs/contract-gaps.md. */
  demo: DemoFixture | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new ApiError("The server could not be reached.", null);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `The server answered with status ${response.status}.`, response.status);
  }
  return (await response.json()) as T;
}

export const fetchQueue = () => getJson<QueueResponse>("/api/queue");
export const fetchMember = (id: string) => getJson<MemberResponse>(`/api/members/${encodeURIComponent(id)}`);
