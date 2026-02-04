export type CanonicalSolution = {
  key: string;
  match: RegExp;
  summary: string;
};

export const CANONICAL_SOLUTIONS: CanonicalSolution[] = [
  {
    key: "equipment-screen",
    match: /\b(equipment\s*screens?|mechanical\s*screens?|mech(?:anical)?\s*screens?|screen\s*walls?)\b/i,
    summary:
      "Equipment screens are typically supported using a non-penetrating rooftop framing system that distributes loads across the roof while maintaining membrane integrity. At Anchor, equipment screens are commonly secured using 2000-series anchors paired with strut framing, stabilizing the screen against movement without creating roof penetrations. This approach is often shared with signage applications, with anchors matched to the roof membrane for long-term watertight performance.",
  },

  {
    key: "solar",
    match: /\b(solar|pv|p\.?v\.?|photovoltaic|panel(?:s)?|array(?:s)?|racking|rack(?:s)?|rail(?:s)?)\b/i,
    summary:
      "Solar racking systems are typically supported using membrane-compatible rooftop attachments that provide stable connection points without penetrating the roof assembly. At Anchor, solar installations commonly use 2000-series anchors paired with strut or rail systems, allowing long-term stability while accommodating movement and exposure. Anchors are matched to the roof membrane to maintain watertight integrity.",
  },

  {
    key: "elevated-stack-roof",
    match: /\b(roof[-\s]*mounted\s*(?:elevated\s*)?(?:stack|stacks)|elevated\s*(?:exhaust\s*)?stack(?:s)?|exhaust\s*stack(?:s)?|roof\s*exhaust(?:\s*stack)?(?:s)?)\b/i,
    summary:
      "Roof mounted elevated stacks are typically stabilized using tie-down solutions rather than rigid framing. At Anchor, these systems commonly use a guy wire kit paired with 2000-series anchors, allowing the stack to remain secure while minimizing roof disruption and preserving membrane integrity.",
  },

  {
    key: "signage",
    // Avoid matching generic "sign" in normal speech (e.g., "sign off", "good sign")
    // Require signage-ish phrasing
    match: /\b(signage|roof\s*sign(?:s)?|building\s*sign(?:s)?|sign\s*frame(?:s)?|sign\s*support(?:s)?|sign\s*mount(?:s)?)\b/i,
    summary:
      "Signage systems are typically supported using non-penetrating rooftop attachment solutions that stabilize the sign while distributing forces across the roof. At Anchor, signage applications commonly use 2000-series anchors in a configuration similar to equipment screen installations, with anchors matched to the roof membrane for watertight performance.",
  },

  {
    key: "camera-light-mount",
    match: /\b(camera(?:s)?|cctv|security\s*camera(?:s)?|light\s*mount(?:s)?|light\s*pole(?:s)?|lighting\s*mount(?:s)?|flood\s*light(?:s)?)\b/i,
    summary:
      "Camera and light mounts are supported using rooftop attachment solutions designed for rigid, long-term stability. At Anchor, these applications commonly use 3000-series anchors, creating membrane-integrated attachment points that support elevated fixtures while maintaining watertight integrity.",
  },

  {
    key: "hvac-tiedown",
    match: /\b(hvac|rtu(?:s)?|rooftop\s*unit(?:s)?|mechanical\s*unit(?:s)?|ac\s*unit(?:s)?|a\/c\s*unit(?:s)?|air\s*handler(?:s)?)\b/i,
    summary:
      "Existing mechanical equipment is typically stabilized using tie-down solutions rather than rigid framing. At Anchor, these applications commonly use a guy wire kit paired with 2000-series anchors, reinforcing the equipment against movement while preserving the roof membrane and existing installation.",
  },
];
