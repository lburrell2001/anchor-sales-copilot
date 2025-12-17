import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DocType =
  | "sales_sheet"
  | "data_sheet"
  | "product_data_sheet"
  | "install_manual"
  | "install_sheet"
  | "install_video"
  | "cad_dwg"
  | "cad_step"
  | "product_drawing"
  | "product_image"
  | "render"
  | "asset"
  | "unknown";

function docTypeFromPath(path: string): DocType {
  const p = path.toLowerCase();

  if (p.includes("sales-sheet")) return "sales_sheet";
  if (p.includes("tech-data-sheet")) return "data_sheet";
  if (p.includes("data-sheet")) return "data_sheet";
  if (p.includes("product-data-sheet")) return "product_data_sheet";
  if (p.includes("install-manual")) return "install_manual";
  if (p.includes("install-sheet")) return "install_sheet";
  if (p.includes("install-video") || p.endsWith(".mp4")) return "install_video";
  if (p.endsWith(".dwg")) return "cad_dwg";
  if (p.endsWith(".step") || p.endsWith(".stp")) return "cad_step";
  if (p.includes("product-drawing") || p.endsWith(".svg")) return "product_drawing";
  if (p.includes("product-image")) return "product_image";
  if (p.includes("render")) return "render";
  if (p.includes(".emptyfolderplaceholder")) return "unknown";

  return "asset";
}

function titleFromPath(path: string) {
  const file = path.split("/").pop() || path;
  return file.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const folder = searchParams.get("folder");

  if (!folder) {
    return NextResponse.json({ error: "Missing folder" }, { status: 400 });
  }

  const bucket = "knowledge";

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list(folder, { limit: 200, offset: 0, sortBy: { column: "name", order: "asc" } });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const files = (data || [])
    .filter((x) => x.name && !x.name.startsWith("."))
    .map((x) => {
      const fullPath = `${folder}/${x.name}`;
      return {
        name: x.name,
        path: fullPath,
        doc_type: docTypeFromPath(fullPath),
        title: titleFromPath(fullPath),
      };
    });

  // Sign each file (15 minutes)
  const signed = await Promise.all(
    files.map(async (f) => {
      const { data: signedData } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(f.path, 60 * 15);

      return { ...f, url: signedData?.signedUrl || null };
    })
  );

  return NextResponse.json({ folder, files: signed });
}
