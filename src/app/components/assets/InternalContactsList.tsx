"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ProductRow = { id: string; name: string | null };

type ContactRow = {
  id: string;
  full_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  territory: string | null;
  notes: string | null;
  active: boolean;
};

type ProfileRow = { id: string; role: string };

function isInternalRole(role: string) {
  return role === "admin" || role === "anchor_rep";
}

export default function InternalContactsList({ productId }: { productId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);

  const [isInternalUser, setIsInternalUser] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [adding, setAdding] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    company: "",
    email: "",
    phone: "",
    territory: "",
    notes: "",
    active: true,
  });

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!productId) {
        setError("Missing product id.");
        setLoading(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (!user) {
        setError("Not signed in.");
        setLoading(false);
        return;
      }

      // role
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id,role")
          .eq("id", user.id)
          .maybeSingle();

        const role = (prof as ProfileRow | null)?.role || "";
        const internal = isInternalRole(role);
        setIsInternalUser(internal);
        setIsAdmin(role === "admin");
      } catch {
        setIsInternalUser(false);
        setIsAdmin(false);
      }

      // product title
      const { data: p, error: pErr } = await supabase
        .from("products")
        .select("id,name")
        .eq("id", productId)
        .maybeSingle();

      if (pErr || !p) {
        setError(pErr?.message || "Internal list not found.");
        setLoading(false);
        return;
      }

      // memberships -> contacts
      const { data: rows, error: cErr } = await supabase
        .from("internal_contact_memberships")
        .select("contact:internal_contacts(id,full_name,company,email,phone,territory,notes,active)")
        .eq("product_id", productId);

      if (cErr) {
        setError(cErr.message);
        setLoading(false);
        return;
      }

      const list = (rows ?? []).map((r: any) => r.contact).filter(Boolean) as ContactRow[];

      setProduct(p as ProductRow);
      setContacts(list);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || "Failed to load internal contacts.");
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function submitAddContact(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg(null);

    if (!isInternalUser) {
      setFormMsg("You don’t have permission to add contacts.");
      return;
    }

    const full_name = form.full_name.trim();
    if (!full_name) {
      setFormMsg("Full name is required.");
      return;
    }

    setAdding(true);

    // 1) create contact
    const { data: newContact, error: insErr } = await supabase
      .from("internal_contacts")
      .insert({
        full_name,
        company: form.company.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        territory: form.territory.trim() || null,
        notes: form.notes.trim() || null,
        active: !!form.active,
      })
      .select("id")
      .maybeSingle();

    if (insErr || !newContact?.id) {
      setFormMsg(insErr?.message || "Failed to add contact.");
      setAdding(false);
      return;
    }

    // 2) link membership to this internal list product
    const { error: memErr } = await supabase.from("internal_contact_memberships").insert({
      product_id: productId,
      contact_id: newContact.id,
    });

    if (memErr) {
      setFormMsg(memErr.message);
      setAdding(false);
      return;
    }

    setForm({
      full_name: "",
      company: "",
      email: "",
      phone: "",
      territory: "",
      notes: "",
      active: true,
    });
    setFormMsg("Added!");
    setAdding(false);
    await load();
  }

  return (
    <main className="min-h-dvh bg-[#F6F7F8] text-black">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-[#047835] pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/assets"
              className="h-9 w-9 rounded-md bg-white/10 border border-white/20 flex items-center justify-center shrink-0"
              title="Back to Asset Library"
            >
              <img src="/anchorp.svg" alt="Anchor Products" className="h-10 w-auto" />
            </Link>

            <div className="leading-tight min-w-0">
              <div className="text-sm font-semibold tracking-wide truncate text-white">Internal contacts</div>
              <div className="text-[12px] text-white/75 truncate">{product?.name || "Internal list"}</div>
            </div>
          </div>

          <Link
            href="/assets"
            className="shrink-0 inline-flex items-center rounded-xl bg-white/10 px-3 py-2 text-[12px] font-semibold text-white border border-white/15 hover:bg-white/15 transition"
          >
            Asset Library
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-5 py-6 space-y-4">
        <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-black">Contacts</div>
              <div className="mt-1 text-sm text-[#76777B]">Internal-only list.</div>
            </div>

            <div className="text-[12px] text-black/50 shrink-0">
              {!loading && !error ? `${contacts.length} contact${contacts.length === 1 ? "" : "s"}` : ""}
            </div>
          </div>

          <div className="mt-4">
            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
            ) : loading ? (
              <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">
                Loading…
              </div>
            ) : contacts.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-[#F6F7F8] p-4 text-sm text-black/60">
                No contacts yet.
              </div>
            ) : (
              <div className="grid gap-3">
                {contacts.map((c) => (
                  <div key={c.id} className="rounded-2xl border border-black/10 bg-white p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-black truncate">{c.full_name}</div>
                        <div className="mt-1 text-[12px] text-[#76777B] truncate">
                          {c.company || "—"}
                          {c.territory ? ` • ${c.territory}` : ""}
                          {!c.active ? " • Inactive" : ""}
                        </div>

                        <div className="mt-2 flex flex-col gap-1 text-sm text-black/80">
                          {c.email ? <div className="truncate">{c.email}</div> : null}
                          {c.phone ? <div className="truncate">{c.phone}</div> : null}
                          {c.notes ? <div className="text-[12px] text-black/60 line-clamp-2">{c.notes}</div> : null}
                        </div>
                      </div>

                      <div className="w-full sm:w-auto sm:shrink-0 flex flex-col gap-2">
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="inline-flex w-full items-center justify-center rounded-xl bg-[#047835] px-3 py-2 text-[12px] font-semibold text-white whitespace-nowrap sm:w-auto"
                          >
                            Email
                          </a>
                        ) : null}

                        {c.phone ? (
                          <a
                            href={`tel:${c.phone}`}
                            className="inline-flex w-full items-center justify-center rounded-xl border border-black/10 bg-white px-3 py-2 text-[12px] font-semibold text-black whitespace-nowrap sm:w-auto"
                          >
                            Call
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Add Contact (internal users only; you can tighten this to admin-only if you want) */}
        {isInternalUser && (
          <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-black">Add contact</div>
            <div className="mt-1 text-sm text-[#76777B]">
              {isAdmin ? "Admin" : "Internal"} only. This adds a contact and links it to this list.
            </div>

            <form onSubmit={submitAddContact} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                value={form.full_name}
                onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))}
                placeholder="Full name *"
                className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
              />

              <input
                value={form.company}
                onChange={(e) => setForm((s) => ({ ...s, company: e.target.value }))}
                placeholder="Company"
                className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
              />

              <input
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                placeholder="Email"
                className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
              />

              <input
                value={form.phone}
                onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                placeholder="Phone"
                className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
              />

              <input
                value={form.territory}
                onChange={(e) => setForm((s) => ({ ...s, territory: e.target.value }))}
                placeholder="Territory (e.g. TX / OK)"
                className="h-10 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 text-sm outline-none focus:border-[#047835]"
              />

              <label className="inline-flex items-center gap-2 text-[12px] text-black/70">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((s) => ({ ...s, active: e.target.checked }))}
                  className="h-4 w-4 accent-[#047835]"
                />
                Active
              </label>

              <textarea
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Notes"
                className="min-h-[90px] sm:col-span-2 rounded-2xl border border-black/10 bg-[#F6F7F8] px-4 py-3 text-sm outline-none focus:border-[#047835]"
              />

              <div className="sm:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="submit"
                  disabled={adding}
                  className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#047835] px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {adding ? "Adding…" : "Add contact"}
                </button>

                
                  
                
              </div>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
