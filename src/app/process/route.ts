import { NextResponse } from "next/server";
import { UPLOAD } from "@lib/config/scoring";
import { runPipeline, SchemaError } from "@lib/pipeline";
import { readWorkbookBytes } from "@lib/pipeline/ingest";
import type { ValidationError } from "@lib/pipeline/types";
import { demoFixtures } from "@/lib/data";

export const runtime = "nodejs";

const fail = (status: number, errors: ValidationError[]) => NextResponse.json({ ok: false, errors }, { status });
const message = (text: string): ValidationError[] => [{ sheet: null, message: text }];
const tooLarge = () => fail(413, message(`The file is larger than the ${UPLOAD.maxBytes / (1024 * 1024)} MB limit.`));

/** Runs the pipeline in memory on an uploaded workbook. Writes nothing, and answers errors with JSON. */
export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > UPLOAD.maxBytes + 64 * 1024) return tooLarge();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, message('Send the workbook as multipart form data in a field named "file".'));
    }
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, message('No file found in the "file" field.'));
    if (!/\.xlsx$/i.test(file.name)) return fail(415, message("Only .xlsx files are accepted."));
    if (file.size > UPLOAD.maxBytes) return tooLarge();

    const bytes = new Uint8Array(await file.arrayBuffer());
    let workbook;
    try {
      workbook = readWorkbookBytes(bytes);
    } catch {
      return fail(422, message("The file could not be read as an Excel workbook."));
    }

    const { dataset, report } = runPipeline(workbook, { workbookName: file.name });
    for (const member of dataset.members) {
      const fixture = demoFixtures[member.id];
      if (fixture) dataset.demo[member.id] = fixture;
    }
    return NextResponse.json({ ok: true, dataset, report });
  } catch (error) {
    if (error instanceof SchemaError) return fail(422, error.errors);
    console.error("Pipeline failed on an uploaded workbook", error);
    return fail(422, message("The workbook could not be processed. Check that it follows the expected layout."));
  }
}
