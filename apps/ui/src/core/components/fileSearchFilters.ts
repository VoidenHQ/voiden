export interface FileSearchFilterOptions {
  /** IntelliJ-style mask, e.g. `*.ts`, `!*.json`, comma-separated */
  fileMask?: string;
}

/** Returns true when the file should be omitted from Cmd+P results. */
export function shouldHideFromFileSearch(
  fileName: string,
  options: FileSearchFilterOptions,
): boolean {
  const mask = options.fileMask?.trim();
  if (!mask) {
    return false;
  }

  return !matchesFileMask(fileName, mask);
}

function matchesFileMask(fileName: string, mask: string): boolean {
  const patterns = mask
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (patterns.length === 0) {
    return true;
  }

  const includes: string[] = [];
  const excludes: string[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      excludes.push(pattern.slice(1).trim());
    } else {
      includes.push(pattern);
    }
  }

  const matchesPattern = (pattern: string) => globToRegex(pattern).test(fileName);

  if (excludes.some(matchesPattern)) {
    return false;
  }

  if (includes.length === 0) {
    return true;
  }

  return includes.some(matchesPattern);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
