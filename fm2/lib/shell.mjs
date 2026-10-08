// Turning values into text another program parses: a POSIX shell, or Codex's
// `-c key=value` overrides, which read their value as TOML.

// One single-quoted shell word, whatever the value holds.
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// An inline TOML value. Codex's `-c` takes TOML, and hook groups are nested
// arrays and tables that have to arrive on one line.
export function tomlValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${key}=${tomlValue(item)}`).join(',')}}`;
  }
  throw new Error('unsupported hook configuration value');
}
