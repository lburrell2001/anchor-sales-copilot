"use client";

import { useEffect, useState } from "react";

type DocRow = {
  document_id: string;
  title: string;
  allowed: boolean;
  total_downvotes: number;
  total_upvotes: number;
};

type CorrectionRow = {
  id: string;
  created_at: string;
  correction_text: string;
  proposed_doc_id: string | null;
  status: string;
};

export default function LearningAdminPage() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/learning/summary", { cache: "no-store" });
    const json = await res.json();
    setDocs(json.docs || []);
    setCorrections(json.corrections || []);
    setLoading(false);
  }

  async function act(body: any) {
    await fetch("/api/admin/learning/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6 text-sm">
      <div className="mb-4 text-lg font-semibold">Learning Admin</div>

      {loading ? (
        <div className="opacity-70">Loading…</div>
      ) : (
        <div className="grid gap-8">
          <section>
            <div className="mb-2 font-medium">Most downvoted documents</div>
            <div className="border border-white/10">
              {docs.length === 0 ? (
                <div className="p-3 opacity-70">No data yet.</div>
              ) : (
                docs.map((d) => (
                  <div
                    key={d.document_id}
                    className="flex items-center justify-between gap-3 border-b border-white/10 p-3"
                  >
                    <div>
                      <div className="font-medium">{d.title}</div>
                      <div className="opacity-70">
                        👎 {d.total_downvotes} / 👍 {d.total_upvotes}{" "}
                        <span className="ml-2">
                          allowed: {String(d.allowed)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {d.allowed ? (
                        <button
                          className="border border-white/20 px-2 py-1"
                          onClick={() =>
                            act({ action: "disable_doc", documentId: d.document_id })
                          }
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          className="border border-white/20 px-2 py-1"
                          onClick={() =>
                            act({ action: "enable_doc", documentId: d.document_id })
                          }
                        >
                          Enable
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 font-medium">Open correction tickets</div>
            <div className="border border-white/10">
              {corrections.length === 0 ? (
                <div className="p-3 opacity-70">No open corrections.</div>
              ) : (
                corrections.map((c) => (
                  <div key={c.id} className="border-b border-white/10 p-3">
                    <div className="opacity-70">
                      {new Date(c.created_at).toLocaleString()}
                    </div>
                    <div className="mt-1">{c.correction_text}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="border border-white/20 px-2 py-1"
                        onClick={() =>
                          act({ action: "close_correction", correctionId: c.id })
                        }
                      >
                        Close
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
