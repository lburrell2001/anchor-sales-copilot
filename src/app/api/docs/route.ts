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

function normalize(s: string) {
  return (s || "").toLowerCase().trim();
}

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
  // allow "" (root)
  if (folder == null) return false;

  const f = folder.trim();

  if (f.includes("..")) return false;
  if (f.startsWith("/")) return false;
  if (f.includes("\\")) return false;

  return true;
}

/**
 * Recursively list a prefix in Supabase Storage.
 * - Works even when files are inside nested subfolders.
 * - Stops at maxFiles to avoid runaway.
 */
async function listRecursive(opts: {
  bucket: string;
  prefix: string; // "" for root
  maxFiles: number;
}) {
  const { bucket, prefix, maxFiles } = opts;

  // BFS queue of prefixes to visit
  const queue: string[] = [prefix || ""];
  const outPaths: string[] = [];

  while (queue.length && outPaths.length < maxFiles) {
    const currentPrefix = queue.shift() ?? "";

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(currentPrefix, {
        limit: 200,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      throw new Error(error.message);
    }

    for (const item of data || []) {
      if (!item?.name) continue;
      if (item.name.startsWith(".")) continue;

      // In Supabase Storage list(), folders generally have `id: null`
      const isFolder = (item as any).id == null;

      if (isFolder) {
        const nextPrefix = currentPrefix ? `${currentPrefix}/${item.name}` : item.name;
        queue.push(nextPrefix);
      } else {
        const fullPath = currentPrefix ? `${currentPrefix}/${item.name}` : item.name;

        if (fullPath.toLowerCase().includes(".emptyfolderplaceholder")) continue;

        outPaths.push(fullPath);
        if (outPaths.length >= maxFiles) break;
      }
    }
  }

  return outPaths;
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);

    // folder is optional now
    const folder = (searchParams.get("folder") || "").trim(); // "" = root
    const qRaw = (searchParams.get("q") || "").trim(); // substring search
    const q = normalize(qRaw);

    const limitParam = Number(searchParams.get("limit") || "200");
    const maxFiles = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 400)
      : 200;

    if (!isSafeFolder(folder)) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    const bucket = "knowledge";

    // 1) list recursively from folder (or root)
    const allPaths = await listRecursive({
      bucket,
      prefix: folder, // can be ""
      maxFiles: q ? 400 : maxFiles, // when searching, grab more then filter down
    });

    // 2) optional substring search
    const filteredPaths = q
      ? allPaths.filter((p) => {
          const hay = normalize(`${titleFromPath(p)} ${docTypeFromPath(p)} ${p}`);
          return hay.includes(q);
        })
      : allPaths;

    const finalPaths = filteredPaths.slice(0, maxFiles);

    const files = finalPaths.map((path) => ({
      name: path.split("/").pop() || path,
      path,
      doc_type: docTypeFromPath(path),
      title: titleFromPath(path),
    }));

    // Sign each file (15 minutes)
    const signed = await Promise.all(
      files.map(async (f) => {
        const { data: signedData } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(f.path, 60 * 15);

        return { ...f, url: signedData?.signedUrl || null };
      })
    );

    console.log("DOCS_ROUTE_DEBUG", {
      folder: folder || "(root)",
      q: qRaw || null,
      listedPaths: allPaths.length,
      returned: signed.length,
      sample: signed.slice(0, 3).map((x) => x.path),
    });

    return NextResponse.json(
      { folder: folder || "", q: qRaw || null, files: signed },
      { headers: res.headers }
    );
  } catch (e: any) {
    console.error("DOCS_ROUTE_ERROR:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
