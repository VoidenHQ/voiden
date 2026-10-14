const VARIABLE_REFERENCE_REGEX = /\{\{([^}]+)\}\}/g;

export class UnresolvedVariablesError extends Error {
  readonly unresolved: string[];

  constructor(message: string, unresolved: string[]) {
    super(message);
    this.name = 'UnresolvedVariablesError';
    this.unresolved = unresolved;
  }
}

function shouldSkipVariable(name: string): boolean {
  return (
    name.startsWith('$req.') ||
    name === '$req' ||
    name.startsWith('$res.') ||
    name === '$res' ||
    name.startsWith('$faker.') ||
    name === '$faker'
  );
}

function findUnresolvedInText(text: string): string[] {
  const blocking = new Set<string>();

  for (const match of text.matchAll(VARIABLE_REFERENCE_REGEX)) {
    const name = match[1]?.trim();
    if (name && !shouldSkipVariable(name)) {
      blocking.add(name);
    }
  }

  return [...blocking].sort((a, b) => a.localeCompare(b));
}

export function formatUnresolvedVariablesError(unresolved: string[]): string {
  const envVars = unresolved.filter((name) => !name.startsWith('process.'));
  const processVars = unresolved.filter((name) => name.startsWith('process.'));
  const parts: string[] = [];

  if (envVars.length > 0) {
    const list = envVars.map((name) => `\`${name}\``).join(', ');
    parts.push(
      `Cannot send request: unresolved environment variable(s): ${list}. Add them to your active environment or fix the spelling.`,
    );
  }

  if (processVars.length > 0) {
    const list = processVars.map((name) => `\`${name}\``).join(', ');
    parts.push(
      `Cannot send request: unresolved runtime variable(s): ${list}. Capture them in a prior request, set them in .voiden/.process.env.json, or fix the spelling.`,
    );
  }

  return parts.join('\n');
}

export function validateResolvedStrings(
  parts: string[],
): { ok: true } | { ok: false; unresolved: string[]; message: string } {
  const unresolved = findUnresolvedInText(parts.filter((part) => part.length > 0).join('\n'));

  if (unresolved.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    unresolved,
    message: formatUnresolvedVariablesError(unresolved),
  };
}

export function assertNoUnresolvedTemplates(parts: string[]): void {
  const result = validateResolvedStrings(parts);
  if (!result.ok) {
    throw new UnresolvedVariablesError(result.message, result.unresolved);
  }
}
