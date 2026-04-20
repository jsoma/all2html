/**
 * Template system supporting Mustache and EJS syntax.
 * Variables are looked up case-insensitively in the replacements object.
 */

const MUSTACHE_RE = /\{\{\{?\s*([\w-]+)\s*\}?\}\}/g;
const EJS_RE = /<%[=-]\s*([\w-]+)\s*%>/g;

function lookupVar(name: string, replacements: Record<string, string>): string | undefined {
  if (name in replacements) return replacements[name];
  const lower = name.toLowerCase();
  if (lower in replacements) return replacements[lower];
  // Case-insensitive search
  for (const key of Object.keys(replacements)) {
    if (key.toLowerCase() === lower) return replacements[key];
  }
  return undefined;
}

export function applyTemplate(template: string, replacements: Record<string, string>): string {
  let result = template;

  // Replace Mustache variables
  result = result.replace(MUSTACHE_RE, (match, name: string) => {
    const value = lookupVar(name, replacements);
    return value !== undefined ? value : match;
  });

  // Replace EJS variables
  result = result.replace(EJS_RE, (match, name: string) => {
    const value = lookupVar(name, replacements);
    return value !== undefined ? value : match;
  });

  return result;
}
