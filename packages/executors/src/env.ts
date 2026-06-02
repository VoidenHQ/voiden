/**
 * Replace {{key}} placeholders in a string with values from an env map.
 * Unresolved placeholders are left as-is.
 */
export function replaceEnvVars(text: string, env: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => env[key.trim()] ?? match)
}
