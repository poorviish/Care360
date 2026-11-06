import { NextResponse } from "next/server";
import { dataset } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const member = dataset.members.find((m) => m.id === decodeURIComponent(id).toUpperCase());
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  return NextResponse.json({
    asOf: dataset.asOf,
    member,
    flags: dataset.flags.filter((f) => f.memberId === member.id),
    demo: dataset.demo[member.id] ?? null,
  });
}
