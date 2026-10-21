/**
 * Normalization helpers for trajectory signals.
 *
 * Normalization is deliberately crude but deterministic: its only job is to
 * map "the same failure / the same action / the same file" to the same
 * signature, and "different" to different signatures. It must not be clever
 * enough to merge distinct failures.
 */

/** FNV-1a 32-bit, hex. Dependency-free, stable across processes. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Collapse a shell command to a stable form: quoted strings, paths, and
 * numbers become placeholders, case and whitespace are normalized.
 * `npm test --testPathPattern=a` and `...=b` normalize alike.
 */
export function normalizeCommand(cmd: string): string {
  return cmd
    .toLowerCase()
    .replace(/"[^"\n]*"|'[^'\n]*'/g, "<s>")
    .replace(PATH_TOKEN, "<p>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Path-like token: at least one "/" segment, e.g. `foo/bar`, `/abs/path`,
 * `./x`. Replacing the whole token (not just the prefix before "/") keeps
 * `...=foo/Bar` and `...=other/Baz` equal.
 */
const PATH_TOKEN = /[\w.$~-]*(?:\/\w[\w.$~-]*)+\/?/g;

/**
 * Collapse an error output tail: addresses, numbers, paths, case, whitespace.
 * Keeps words (e.g. `error: cannot find module`), so structurally identical
 * failures hash alike while different failures hash differently.
 */
export function normalizeErrorText(text: string): string {
  const tail = text.slice(-800).toLowerCase();
  return tail
    .replace(/0x[0-9a-f]+/g, "<addr>")
    .replace(PATH_TOKEN, "<p>")
    .replace(/\b\d+(\.\d+)?(ms|s|kb|mb|gb|%)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function errorSignature(text: string): string {
  return fnv1a(normalizeErrorText(text));
}
