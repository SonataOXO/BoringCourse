import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import { inferConceptFromTitle } from "@/lib/server/insights";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const assignmentTitle = (formData.get("assignmentTitle") as string | null) ?? "";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file in form-data under 'file'" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 400 });
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedText = "";

    if (file.type.includes("text") || extension === "txt" || extension === "md") {
      extractedText = await file.text();
    } else if (file.type.includes("pdf") || extension === "pdf") {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      extractedText = result.text;
    } else if (
      file.type.includes("word") ||
      file.type.includes("officedocument") ||
      extension === "docx"
    ) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else {
      return NextResponse.json(
        {
          error: "Unsupported file type. Please upload txt, pdf, or docx.",
        },
        { status: 400 },
      );
    }

    const normalized = extractedText.replace(/\s+/g, " ").trim();
    const wordCount = normalized.length > 0 ? normalized.split(" ").length : 0;

    return NextResponse.json({
      fileName: file.name,
      mimeType: file.type,
      wordCount,
      conceptHint: assignmentTitle ? inferConceptFromTitle(assignmentTitle) : "",
      preview: normalized.slice(0, 1200),
      content: extractedText,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to parse file upload",
      },
      { status: 400 },
    );
  }
}
