export type CanonicalSolution = {
  key: string;
  match: RegExp;
  summary: string;
};

export const CANONICAL_SOLUTIONS: CanonicalSolution[] = [
  // -------------------------
  // Solar
  // -------------------------
  {
    key: "solar",
    match: /\b(solar|pv|p\.?v\.?|photovoltaic|panel(?:s)?|array(?:s)?|racking|rack(?:s)?|rail(?:s)?)\b/i,
    summary:
      "Solar racking systems are typically supported using membrane-compatible rooftop attachments that provide stable connection points without penetrating the roof assembly. At Anchor, solar installations commonly use 2000-series anchors paired with strut or rail systems, allowing long-term stability while accommodating movement and exposure. Anchors are matched to the roof membrane to maintain watertight integrity.",
  },

  // -------------------------
  // 2 Pipe Snow Fence
  // -------------------------
  {
    key: "2-pipe-snow-fence",
    match: /\b(2\s*pipe\s*snow\s*fence|two\s*pipe\s*snow\s*fence|2[-\s]*pipe\s*fence|two[-\s]*pipe\s*fence)\b/i,
    summary:
      "2 pipe snow fence systems are supported by a continuous rooftop attachment approach that stabilizes the fence while distributing forces evenly across the roof. At Anchor, these systems typically use 2000-series anchors with piping and splices to create a consistent, non-penetrating support structure that integrates with the roof membrane for long-term watertight performance.",
  },

  // -------------------------
  // Snow Fence (generic / unitized)
  // -------------------------
  {
  key: "snow-fence-general",
  match: /\b(snow\s*fence(?:s)?|snow\s*retention)\b/i,
  summary:
    "Snow fence systems are used to manage snow accumulation and shedding on rooftops by providing controlled retention. At Anchor, snow fence solutions vary by application, with unitized systems typically supported using 3000-series anchors and framing for new installations, while two-pipe snow fence systems commonly use 2000-series anchors with piping and splices. The appropriate approach depends on whether the system is unitized or pipe-based, as well as roof membrane compatibility."
},

{
  key: "unitized-snow-fence",
  match: /\b(unitized\s*snow\s*fence|unitized\s*fence)\b/i,
  summary:
    "Unitized snow fence systems are typically supported using rigid rooftop framing designed for new installations. At Anchor, unitized snow fences commonly use 3000-series anchors paired with structural framing to provide stable, long-term support while maintaining membrane compatibility and watertight integrity."
},


  // -------------------------
  // Roof Mounted Box
  // -------------------------
  {
    key: "roof-mounted-box",
    match: /\b(roof\s*mounted\s*box(?:es)?|roof\s*box(?:es)?|rooftop\s*box(?:es)?|enclosure(?:s)?\s*(?:on\s*the\s*roof|rooftop))\b/i,
    summary:
      "Roof mounted boxes are typically supported using non-penetrating rooftop attachment points that secure the enclosure while preserving the roof membrane. At Anchor, these applications commonly use 2000-series anchors with strut framing to create a stable mounting platform, with anchors matched to the roof membrane for long-term watertight performance.",
  },

  // -------------------------
  // Electrical Disconnect
  // -------------------------
  {
    key: "electrical-disconnect",
    match: /\b(electrical\s*disconnect(?:s)?|ac\s*disconnect(?:s)?|a\/c\s*disconnect(?:s)?|service\s*disconnect(?:s)?|disconnect\s*switch(?:es)?)\b/i,
    summary:
      "Electrical disconnects on the roof are typically supported using non-penetrating attachment solutions that keep equipment elevated, stable, and serviceable while protecting the roof system. At Anchor, these applications commonly use 2000-series anchors with strut framing, with anchors matched to the roof membrane to maintain watertight integrity.",
  },

  // -------------------------
  // Wall Mounted Box
  // -------------------------
  {
    key: "wall-mounted-box",
    match: /\b(wall\s*mounted\s*box(?:es)?|wall\s*box(?:es)?|vertical\s*mounted\s*box(?:es)?|wall\s*enclosure(?:s)?)\b/i,
    summary:
      "Wall mounted boxes are typically supported using attachment solutions that create a stable mounting point at the roof-to-wall interface while maintaining membrane compatibility. At Anchor, these applications commonly use 3000-series anchors with strut framing to support the enclosure without compromising long-term roof performance.",
  },

  // -------------------------
  // Roof Pipe Securement
  // -------------------------
  {
    key: "roof-pipe-securement",
    match: /\b(roof\s*pipe\s*securement|pipe\s*securement|rooftop\s*pip(?:e|ing)|piping\s*support(?:s)?|pipe\s*support(?:s)?)\b/i,
    summary:
      "Rooftop piping is typically supported using attachment solutions that distribute loads while allowing for movement and long-term exposure. At Anchor, roof pipe securement commonly uses 3000-series anchors to create membrane-integrated attachment points that support piping systems without introducing penetrations, with anchors matched to the roof membrane for watertight performance.",
  },

  // -------------------------
  // Duct Securement
  // -------------------------
  {
    key: "duct-securement",
    match: /\b(duct\s*securement|ductwork\s*securement|duct\s*support(?:s)?|ductwork\s*support(?:s)?|rooftop\s*duct(?:s)?|ductwork)\b/i,
    summary:
      "Rooftop ductwork is typically supported using stable, non-penetrating attachment solutions that preserve the roof membrane while helping control movement over time. At Anchor, duct securement commonly uses membrane-compatible rooftop attachment points paired with framing components, keeping the system secure without turning the roof assembly into a weak point.",
  },

  // -------------------------
  // H-Frame (roof mounted)
  // -------------------------
  {
    key: "roof-mounted-h-frame",
    match: /\b(roof\s*mounted\s*h[-\s]*frame(?:s)?|h[-\s]*frame(?:s)?|roof\s*h[-\s]*frame(?:s)?)\b/i,
    summary:
      "Roof mounted H-frames are typically supported using framing that spans between membrane-integrated attachment points to create balanced, long-term support for rooftop mechanical or piping systems. At Anchor, H-frame applications commonly use 3000-series anchors with strut framing, providing a rigid support structure while maintaining watertight roof performance.",
  },

  // -------------------------
  // HVAC Tie Down (existing)
  // -------------------------
  {
    key: "hvac-tie-down",
    match: /\b(hvac\s*tie[-\s]*down(?:s)?|rtu\s*tie[-\s]*down(?:s)?|tie[-\s]*down(?:s)?\s*(?:for\s*)?(?:hvac|rtu|rooftop\s*unit)|rooftop\s*unit(?:s)?|rtu(?:s)?)\b/i,
    summary:
      "Existing mechanical equipment is typically stabilized using tie-down solutions that reinforce the unit without requiring a full reframe. At Anchor, these applications commonly use a guy wire kit paired with 2000-series anchors, helping control movement while preserving the roof membrane and existing installation.",
  },

  // -------------------------
  // Existing pipe/duct (tie-down style)
  // -------------------------
  {
    key: "existing-pipe-duct",
    match: /\b(existing\s*(?:pipe|piping|duct|ductwork)\b|re[-\s]*secure(?:ment)?\s*(?:pipe|duct)|retrofit\s*(?:pipe|duct)|existing\s*frame\s*(?:pipe|duct)?)\b/i,
    summary:
      "Existing pipe and duct systems are typically stabilized using tie-down solutions rather than full replacement framing. At Anchor, these applications commonly use a guy wire kit paired with 2000-series anchors to help control movement while minimizing disruption to the roof and preserving membrane integrity.",
  },

  // -------------------------
  // Roof mounted elevated stack / exhaust
  // -------------------------
  {
    key: "roof-mounted-elevated-stack",
    match: /\b(roof[-\s]*mounted\s*(?:elevated\s*)?(?:stack|stacks)|elevated\s*(?:exhaust\s*)?stack(?:s)?|exhaust\s*stack(?:s)?|roof\s*exhaust(?:\s*stack)?(?:s)?)\b/i,
    summary:
      "Roof mounted elevated stacks are typically stabilized using tie-down solutions rather than rigid framing. At Anchor, these systems commonly use a guy wire kit paired with 2000-series anchors, helping keep the stack secure while minimizing roof disruption and maintaining membrane integrity.",
  },

  // -------------------------
  // Wall mounted elevated stack
  // -------------------------
  {
    key: "wall-mounted-elevated-stack",
    match: /\b(wall[-\s]*mounted\s*(?:elevated\s*)?(?:stack|stacks)|vertical\s*(?:exhaust\s*)?stack(?:s)?\s*(?:at|on)\s*(?:wall|parapet)|stack(?:s)?\s*(?:on|at)\s*(?:parapet|wall))\b/i,
    summary:
      "Wall mounted elevated stacks are typically supported using attachment solutions that create a stable transition at the roof-to-wall interface while preserving the roof system. At Anchor, these applications commonly use 2000-series anchors with strut framing to provide stable support while maintaining watertight performance.",
  },

  // -------------------------
  // Lightning Protection
  // -------------------------
  {
    key: "lightning-protection",
    match: /\b(lightning\s*protection|lightning\s*system(?:s)?|lightning\s*conductors?|air\s*terminal(?:s)?|lightning\s*cable(?:s)?)\b/i,
    summary:
      "Lightning protection components are typically supported using membrane-compatible rooftop attachment points that secure conductors without penetrating the roof. At Anchor, lightning protection applications commonly use 2000-series anchors, providing stable, watertight attachment that integrates cleanly with the roof system over time.",
  },

  // -------------------------
  // Antenna (tie-down)
  // -------------------------
  {
    key: "antenna",
    match: /\b(antenna(?:s)?|radio\s*antenna(?:s)?|cell\s*antenna(?:s)?|communications\s*antenna(?:s)?)\b/i,
    summary:
      "Antennas are commonly stabilized using tie-down systems that help control movement and vibration over time. At Anchor, antenna installations typically use a guy wire kit paired with 2000-series anchors, creating membrane-matched attachment points that maintain watertight roof performance.",
  },

  // -------------------------
  // Satellite Dish
  // -------------------------
  {
    key: "satellite-dish",
    match: /\b(satellite\s*dish(?:es)?|sat\s*dish(?:es)?|satellite\s*antenna(?:s)?|dish\s*mount(?:s)?)\b/i,
    summary:
      "Satellite dishes are typically supported using rooftop attachment solutions that stabilize the dish without penetrating the roof membrane. At Anchor, satellite dish applications commonly use 2000-series anchors to provide a secure, membrane-matched mounting approach that preserves watertight integrity over time.",
  },

  // -------------------------
  // Weather Stations (tie-down)
  // -------------------------
  {
    key: "weather-stations",
    match: /\b(weather\s*station(?:s)?|meteorological\s*station(?:s)?|anemometer(?:s)?|wind\s*sensor(?:s)?|roof\s*weather)\b/i,
    summary:
      "Weather stations are typically stabilized using tie-down solutions that resist movement while minimizing impact to the roof system. At Anchor, these applications commonly use a guy wire kit paired with 2000-series anchors, providing stable, membrane-matched attachment points for long-term monitoring installations.",
  },

  // -------------------------
  // Guy Wire Kit
  // -------------------------
  {
    key: "guy-wire-kit",
    match: /\b(guy\s*wire(?:s)?|guywire(?:s)?|guy\s*wire\s*kit(?:s)?|tie[-\s]*down\s*kit(?:s)?|wire\s*tie[-\s]*down)\b/i,
    summary:
      "Guy wire kits are used in tie-down applications where stabilization is needed without rigid framing. At Anchor, guy wire kits are paired with 2000-series anchors and include wire, brackets, tensioning hardware, and clips to help stabilize existing equipment and rooftop systems while preserving roof integrity.",
  },

  // -------------------------
  // Equipment Screen
  // -------------------------
  {
    key: "equipment-screen",
    match: /\b(equipment\s*screens?|mechanical\s*screens?|mech(?:anical)?\s*screens?|screen\s*walls?)\b/i,
    summary:
      "Equipment screens are typically supported using a non-penetrating rooftop framing system that distributes loads across the roof while maintaining membrane integrity. At Anchor, equipment screens are commonly secured using 2000-series anchors paired with strut framing, stabilizing the screen against movement without creating roof penetrations. This approach is often shared with signage applications, with anchors matched to the roof membrane for long-term watertight performance.",
  },

  // -------------------------
  // Signage
  // -------------------------
  {
    key: "signage",
    match: /\b(signage|roof\s*sign(?:s)?|building\s*sign(?:s)?|sign\s*frame(?:s)?|sign\s*support(?:s)?|sign\s*mount(?:s)?)\b/i,
    summary:
      "Signage systems are typically supported using non-penetrating rooftop attachment solutions that stabilize the sign while distributing forces across the roof. At Anchor, signage applications commonly use 2000-series anchors in a configuration similar to equipment screen installations, with anchors matched to the roof membrane for watertight performance.",
  },

  // -------------------------
  // Light Mount
  // -------------------------
  {
    key: "light-mount",
    match: /\b(light\s*mount(?:s)?|light\s*pole(?:s)?|lighting\s*mount(?:s)?|flood\s*light(?:s)?|area\s*light(?:s)?)\b/i,
    summary:
      "Light mounts are typically supported using rooftop attachment solutions designed for rigid, long-term stability. At Anchor, these applications commonly use 3000-series anchors to create membrane-integrated attachment points that support elevated fixtures while maintaining watertight roof performance.",
  },

  // -------------------------
  // Camera Mount
  // -------------------------
  {
    key: "camera-mount",
    match: /\b(camera\s*mount(?:s)?|camera(?:s)?|cctv|security\s*camera(?:s)?|surveillance\s*camera(?:s)?)\b/i,
    summary:
      "Camera mounts are typically supported using rooftop attachment solutions designed for long-term stability and minimal roof impact. At Anchor, these applications commonly use 3000-series anchors, creating membrane-matched attachment points that maintain watertight integrity over time.",
  },

  // -------------------------
  // Roof Mounted Guardrail
  // -------------------------
  {
    key: "roof-mounted-guardrail",
    match: /\b(roof\s*mounted\s*guardrail(?:s)?|rooftop\s*guardrail(?:s)?|guardrail(?:s)?\s*(?:on|for)\s*roof)\b/i,
    summary:
      "Roof mounted guardrails are typically supported using membrane-integrated attachment points designed for long-term rooftop safety applications. At Anchor, these systems commonly use 3000-series anchors, creating a stable, watertight connection that supports rooftop access and maintenance needs.",
  },

  // -------------------------
  // Wall Mounted Guardrail
  // -------------------------
  {
    key: "wall-mounted-guardrail",
    match: /\b(wall\s*mounted\s*guardrail(?:s)?|guardrail(?:s)?\s*(?:on|for)\s*wall|parapet\s*guardrail(?:s)?)\b/i,
    summary:
      "Wall mounted guardrails are typically supported using attachment solutions that transfer loads into the wall structure while maintaining roof-to-wall compatibility. At Anchor, these systems commonly use 3000-series anchors to provide stable, long-term rooftop safety support while preserving roof performance.",
  },

  // -------------------------
  // Roof Ladder
  // -------------------------
  {
    key: "roof-ladder",
    match: /\b(roof\s*ladder(?:s)?|ladder\s*support(?:s)?|ladder\s*mount(?:s)?|ladder\s*bracket(?:s)?)\b/i,
    summary:
      "Roof ladders are typically supported using non-penetrating rooftop attachment solutions that secure the ladder while protecting the roof membrane. At Anchor, roof ladder applications commonly use 3000-series anchors paired with adjustable support components to provide stable access while maintaining watertight integrity.",
  },

  // -------------------------
  // Roof Mounted Box vs Electrical Disconnect often overlap, but keep both
  // -------------------------

  // -------------------------
  // Roof Mounted H-Frame already included above
  // -------------------------

  // -------------------------
  // Duct Securement already included above
  // -------------------------

  // -------------------------
  // “Exhaust System” (generic phrasing)
  // -------------------------
  {
    key: "exhaust-system",
    match: /\b(exhaust\s*system(?:s)?|exhaust\s*fan(?:s)?|ventilation\s*exhaust|roof\s*exhaust(?:s)?|vent\s*stack(?:s)?)\b/i,
    summary:
      "Rooftop exhaust systems are typically supported using membrane-compatible attachment solutions that stabilize equipment while preserving roof integrity. At Anchor, exhaust-related applications are commonly handled using membrane-matched rooftop attachment points paired with appropriate support components, keeping the system secure while maintaining watertight performance over time.",
  },

  // -------------------------
  // Roof Mounted Box / Wall Mounted Box covered above
  // -------------------------
];
