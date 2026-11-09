export function projectImagePaths(projectName, imageIndex = 1) {
  const projectSlug = projectName.toLowerCase().replace(/\s+/g, "-");
  const basePath = `/images/projects/${projectSlug}-${imageIndex}`;
  return { webp: `${basePath}.webp`, png: `${basePath}.png` };
}

export function cleanPrice(value) {
  return value
    .replace(/^\s*starting\s+from\s+around\s+/i, "")
    .replace(/\s*\(indicative(?:\s+only)?\)\s*$/i, "")
    .trim();
}

export function formatIndicativePrice(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const price = cleanPrice(value);
  const hasAmountAndUnit =
    /(?:\u20b9|rs\.?\s*|inr\s*)\s*[\d,]+(?:\.\d+)?/i.test(price) ||
    /[\d,]+(?:\.\d+)?\s*(?:lakh|lac|crore|cr)\b/i.test(price);
  return hasAmountAndUnit ? `Starting from ${price} (indicative)` : "";
}

export function cleanPossession(value) {
  return value
    .replace(/^\s*possession\s+is\s+planned\s+for\s+/i, "")
    .replace(/,\s*as\s+per\s+the\s+registered\s+timeline.*$/i, "")
    .trim();
}

export function cleanRera(value) {
  return value
    .replace(/^\s*registered\s+under\s+RERA\.\s*/i, "")
    .replace(/^\s*registration\s+number:\s*/i, "")
    .trim();
}
