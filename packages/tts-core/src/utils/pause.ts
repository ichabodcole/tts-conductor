export type PauseTable = Record<string, number>;

function lookup(table: PauseTable, label: string): number {
  return table[label.toUpperCase()] ?? 0;
}

/**
 * Parse pause duration from various pause formats
 * Supports patterns like:
 *   [PAUSE:LABEL]
 *   [PAUSE:LABEL:Nx]
 *   [PAUSE:LABEL:Ns]
 *   [PAUSE:Ns]
 */
export function parsePauseDuration(pauseMatch: string, table: PauseTable): number {
  const content = pauseMatch.replace(/^\[PAUSE:/, '').replace(/\]$/, '');

  const numericMatch = content.match(/^(\d+(?:\.\d+)?)s?$/i);
  if (numericMatch) {
    return parseFloat(numericMatch[1] ?? '0');
  }

  const modifierMatch = content.match(/^([A-Z_]+):(\d+(?:\.\d+)?)([xs])$/i);
  if (modifierMatch) {
    const [, rawLabel, rawValue, suffix] = modifierMatch;
    const label = rawLabel?.toUpperCase() ?? '';
    const numValue = rawValue ? parseFloat(rawValue) : 0;
    const base = lookup(table, label);
    if (suffix?.toLowerCase() === 'x') {
      return base * numValue;
    }
    if (suffix?.toLowerCase() === 's') {
      return numValue;
    }
  }

  const legacyMatch = content.match(/^(BREATH|FULL_BREATH|HALF_BREATH):(\d+)$/i);
  if (legacyMatch) {
    const [, rawLabel, rawMultiplier] = legacyMatch;
    const base = lookup(table, rawLabel?.toUpperCase() ?? '');
    return base * (rawMultiplier ? parseInt(rawMultiplier, 10) : 0);
  }

  return lookup(table, content.toUpperCase());
}

export function isValidPauseFormat(input: string): boolean {
  return /^\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]$/i.test(input);
}

export function extractPauseMarkers(text: string): string[] {
  const matches = text.match(/\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]/gi);
  return matches ?? [];
}
