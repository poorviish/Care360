import { NextResponse } from "next/server";
import { dataset } from "@/lib/data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ asOf: dataset.asOf, asOfSource: dataset.asOfSource, queue: dataset.queue });
}
