// src/app/api/docs/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseRoute } from "@/lib/supabase/server";

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

function isSafeFolder(folder: string) {
  // basic traversal / weird input defense
  if (!folder) return false;
  if (folder.includes("..")) return false;
  if (folder.startsWith("/")) return false;
  if (folder.includes("\\")) return false;
  return true;
}

export async function GET(req: Request) {
  // ✅ allow Supabase to refresh cookies if needed
  const res = NextResponse.next();

  try {
    // ✅ Auth gate (any logged-in user for now)
    const supabase = supabaseRoute(req, res);
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) console.error("DOCS_AUTH_ERROR:", authErr);

    const user = authData.user;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const folder = searchParams.get("folder") || "";

    if (!folder) {
      return NextResponse.json({ error: "Missing folder" }, { status: 400 });
    }

    if (!isSafeFolder(folder)) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    const bucket = "knowledge";

    // ✅ Service role listing/signing (safe because route is auth-gated)
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder, {
      limit: 200,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });

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

    return NextResponse.json(
      { folder, files: signed },
      { headers: res.headers }
    );
  } catch (e: any) {
    console.error("DOCS_ROUTE_ERROR:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
