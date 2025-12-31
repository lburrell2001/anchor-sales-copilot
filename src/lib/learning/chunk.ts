export function chunkText(text: string, maxChars = 900): string[] {
  const cleaned = (text || "").replace(/\r/g, "").trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  let buf = "";

  for (const para of cleaned.split("\n\n")) {
    const p = para.trim();
    if (!p) continue;

    if ((buf + "\n\n" + p).length > maxChars) {
      if (buf) parts.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) parts.push(buf);

  return parts.slice(0, 24);
}
