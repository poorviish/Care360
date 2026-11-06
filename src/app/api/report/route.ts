import { NextResponse } from "next/server";
import { dataset, report } from "@/lib/data";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ ...report, flags: dataset.flags });
}
