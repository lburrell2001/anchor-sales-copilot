import { CANONICAL_SOLUTIONS } from "./canonicalSolutions";

export function resolveCanonicalSolution(text: string): string | null {
  if (!text) return null;

  const normalized = text.toLowerCase();

  for (const solution of CANONICAL_SOLUTIONS) {
    if (solution.match.test(normalized)) {
      return solution.summary;
    }
  }

  return null;
}
