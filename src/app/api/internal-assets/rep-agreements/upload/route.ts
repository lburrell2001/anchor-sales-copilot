// src/app/api/internal-assets/rep-agreements/upload/route.ts
import { NextResponse } from "next/server";
import { supabaseRoute } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isPdf(file: File) {
  return file.type === "application/pdf" || extOf(file.name) === "pdf";
}

function isDocx(file: File) {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extOf(file.name) === "docx"
  );
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseRoute();

    // must be signed in
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // must be internal role
    const { data: prof } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const role = String((prof as any)?.role || "");
    const isInternal = role === "admin" || role === "anchor_rep";
    if (!isInternal) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // parse form data
    const fd = await req.formData();
    const productId = String(fd.get("productId") || "").trim();
    const title = String(fd.get("title") || "").trim();
    const pdf = fd.get("pdf");
    const docx = fd.get("docx");

    if (!productId) return NextResponse.json({ error: "Missing productId" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });
    if (!(pdf instanceof File) || !(docx instanceof File)) {
      return NextResponse.json({ error: "Missing pdf/docx files" }, { status: 400 });
    }
    if (!isPdf(pdf)) return NextResponse.json({ error: "PDF must be a .pdf" }, { status: 400 });
    if (!isDocx(docx)) return NextResponse.json({ error: "Word must be a .docx" }, { status: 400 });

    const ts = Date.now();
    const base = safeFilename(title) || "rep-agreement";

    const pdfPath = `internal/rep-agreements/${productId}/${ts}-${base}.pdf`;
    const docxPath = `internal/rep-agreements/${productId}/${ts}-${base}.docx`;

    // upload to storage (knowledge bucket)
    const pdfBuf = Buffer.from(await pdf.arrayBuffer());
    const docxBuf = Buffer.from(await docx.arrayBuffer());

    const { error: upPdfErr } = await supabaseAdmin.storage.from("knowledge").upload(pdfPath, pdfBuf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upPdfErr) return NextResponse.json({ error: upPdfErr.message }, { status: 400 });

    const { error: upDocErr } = await supabaseAdmin.storage.from("knowledge").upload(docxPath, docxBuf, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
    });
    if (upDocErr) return NextResponse.json({ error: upDocErr.message }, { status: 400 });

    // insert 2 assets rows (internal only)
    const { error: insErr } = await supabaseAdmin.from("assets").insert([
      {
        product_id: productId,
        title: `${title} (PDF)`,
        type: "document",
        category_key: "rep_agreement_pdf",
        path: pdfPath,
        visibility: "internal",
      },
      {
        product_id: productId,
        title: `${title} (Word)`,
        type: "document",
        category_key: "rep_agreement_docx",
        path: docxPath,
        visibility: "internal",
      },
    ]);

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, pdfPath, docxPath });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
