// src/lib/solutions/resolveCanonicalSolution.ts
import { CANONICAL_SOLUTIONS } from "./canonicalSolutions";

/**
 * TEXT-ONLY resolver that behaves like a “Custom GPT parameter picker”.
 *
 * Returns:
 * - the best storage folder prefix (preferred), OR
 * - "solutions/<securing>" when storageFolder is not provided.
 *
 * Design goals:
 * - Recognize multiple naming conventions (sales language ↔ folder taxonomy)
 * - Prefer specific matches over general buckets
 * - Use lightweight “parameters” (existing vs new, roof vs wall) only as tie-breakers
 * - Stay additive: normalization maps synonyms → canonical vocabulary (never destructive)
 *
 * Examples:
 * - "light mount" -> "solutions/light-mount"
 * - "roof mounted h-frame" -> "solutions/pipe-frame/attached"
 * - "existing mechanical tie down" -> "solutions/pipe-frame/existing"
 */
export function resolveCanonicalSolution(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const t = normalizeIntentText(raw);

  // “GPT parameters” (used only for tie-breaking)
  const wantsExisting = /\b(existing|retrofit|re[-\s]?secure|re[-\s]?tie|tie[-\s]?down)\b/i.test(t);

  const wantsWall =
    /\b(wall|parapet|vertical)\b/i.test(t) && !/\b(roof|rooftop)\b/i.test(t);

  const wantsRoof = /\b(roof|rooftop)\b/i.test(t);

  // Some intent hints (optional tie-breakers)
  const mentionsGuyWire = /\b(guy\s*wire|guy-wire|tie[-\s]?down)\b/i.test(t);
  const mentionsBox = /\bbox|enclosure|disconnect\b/i.test(t);
  const mentionsStack = /\b(stack|exhaust)\b/i.test(t);

  let best: { folder: string; score: number } | null = null;

  for (const sol of CANONICAL_SOLUTIONS) {
    // defensive reset in case regex gets a global flag later
    sol.match.lastIndex = 0;

    const m = sol.match.exec(t);
    if (!m) continue;

    const matchText = String(m[0] || "").toLowerCase();
    const matchLenScore = Math.min(34, matchText.length); // longer == more specific (capped)

    const keywordScore = (sol.keywords || []).reduce((acc, kw) => {
      const k = String(kw || "").toLowerCase().trim();
      if (!k) return acc;
      return t.includes(k) ? acc + 6 : acc;
    }, 0);

    const folder = String(sol.storageFolder || "").trim();
    const securing = String(sol.securing || "").trim();

    // Prefer explicit storageFolder when present (real bucket taxonomy)
    const candidate = folder || (securing ? `solutions/${securing}` : "");
    if (!candidate) continue;

    const hasStorageFolderBonus = folder ? 14 : 0;

    // Penalize “general buckets” so specifics win when both match
    const isGeneralBucket =
      /solutions\/(snow-retention|elevated-stack|roof-stairs-walkways|roof-pipe)$/.test(candidate);

    const generalPenalty = isGeneralBucket ? -12 : 0;

    // Tie-breaker intent bonuses (small + only when relevant)
    let intentBonus = 0;

    // Existing vs new (stronger because it changes solutions, esp tie-down vs frame)
    if (wantsExisting) {
      if (candidate.includes("/existing")) intentBonus += 14;
      if (candidate.includes("/attached")) intentBonus -= 6;
    } else {
      // If NOT existing, slightly prefer attached over existing when both match
      if (candidate.includes("/attached")) intentBonus += 4;
      if (candidate.includes("/existing")) intentBonus -= 2;
    }

    // Roof vs wall (matters for stacks + boxes + guardrails)
    if (wantsWall) {
      if (candidate.includes("/wall-") || candidate.includes("wall-box") || candidate.includes("wall-guardrail"))
        intentBonus += 12;
      if (candidate.includes("/roof-") || candidate.includes("roof-box") || candidate.includes("roof-guardrail"))
        intentBonus -= 3;
    }

    if (wantsRoof) {
      if (candidate.includes("/roof-") || candidate.includes("roof-box") || candidate.includes("roof-guardrail"))
        intentBonus += 7;
    }

    // Guy-wire hint (tie-down solutions; your rule: guy wire kits → 2000 series tie-down)
    if (mentionsGuyWire) {
      if (candidate.includes("guy-wire") || candidate.includes("/existing") || candidate.includes("elevated-stack/roof-stack"))
        intentBonus += 10;
    }

    // Box / stack hint (nudges only—don’t override a clear regex match)
    if (mentionsBox) {
      if (candidate.includes("roof-box") || candidate.includes("wall-box") || candidate.includes("electrical-disconnect"))
        intentBonus += 6;
    }
    if (mentionsStack) {
      if (candidate.includes("elevated-stack")) intentBonus += 6;
    }

    const score =
      matchLenScore + keywordScore + hasStorageFolderBonus + intentBonus + generalPenalty;

    if (!best || score > best.score) best = { folder: candidate, score };
  }

  return best?.folder ?? null;
}

/**
 * Normalize + alias user input so synonyms resolve correctly.
 * Keep it additive: map many names → canonical vocabulary.
 *
 * This is the “naming conventions” layer for your Custom GPT behavior.
 */
function normalizeIntentText(input: string) {
  let t = String(input || "").toLowerCase().trim();

  // normalize punctuation/spacing
  t = t.replace(/[_/]+/g, " ");
  t = t.replace(/[^a-z0-9\s-]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();

  // ----------------------------
  // Aliases / naming conventions
  // ----------------------------

  // H-frame / attached pipe frame
  t = t.replace(/\broof\s*mounted\s*h\s*frame\b/g, "pipe frame attached");
  t = t.replace(/\broof\s*mounted\s*h[-\s]*frame\b/g, "pipe frame attached");
  t = t.replace(/\battached\s*pipe[-\s]*frame\b/g, "pipe frame attached");
  t = t.replace(/\bpipe[-\s]*frame\s*attached\b/g, "pipe frame attached");
  t = t.replace(/\bh[-\s]*frame\b/g, "pipe frame"); // generic

  // Snow retention
  t = t.replace(/\bsnow\s*fence\b/g, "snow retention snow fence");
  t = t.replace(/\btwo\s*pipe\b/g, "2 pipe");
  t = t.replace(/\b2[-\s]*pipe\b/g, "2 pipe");
  t = t.replace(/\bunitized\s*fence\b/g, "unitized snow fence");
  t = t.replace(/\bfence\s*panels\b/g, "unitized snow fence");
  t = t.replace(/\bsnow\s*guard(s)?\b/g, "snow retention");

  // Existing / retrofit / tie-down language
  t = t.replace(/\bexisting\s*frame\b/g, "existing pipe frame");
  t = t.replace(/\bretro[-\s]?fit\b/g, "existing");
  t = t.replace(/\bre[-\s]?secure\b/g, "existing");
  t = t.replace(/\bre[-\s]?tie\b/g, "existing tie-down");
  t = t.replace(/\btie[-\s]?down\b/g, "existing tie-down");
  t = t.replace(/\bmechanical\s*tie[-\s]?down\b/g, "hvac existing tie-down"); // common sales phrasing

  // Guy wire kit naming
  t = t.replace(/\bguy[-\s]*wire\s*kit\b/g, "guy wire");
  t = t.replace(/\btightener\b/g, "turnbuckle"); // optional synonym

  // Screens vs signage (treated similarly)
  t = t.replace(/\bequipment\s*screen(s)?\b/g, "equipment screen signage");
  t = t.replace(/\brooftop\s*screen(s)?\b/g, "equipment screen signage");

  // Light/camera mounts (treated similarly)
  t = t.replace(/\bflood\s*light\b/g, "light mount");
  t = t.replace(/\barea\s*light\b/g, "light mount");
  t = t.replace(/\bsecurity\s*camera\b/g, "camera mount");
  t = t.replace(/\bsurveillance\s*camera\b/g, "camera mount");

  // Satellite / antenna naming
  t = t.replace(/\bsatellite\s*antenna\b/g, "satellite dish");
  t = t.replace(/\brf\s*antenna\b/g, "antenna");
  t = t.replace(/\bcommunication\s*antenna\b/g, "antenna");

  // Weather station naming
  t = t.replace(/\brooftop\s*sensor(s)?\b/g, "weather station");
  t = t.replace(/\bmonitoring\s*station(s)?\b/g, "weather station");

  // Parapet hint (wall)
  t = t.replace(/\bparapet\b/g, "wall parapet");

  return t;
}
