/**
 * Minimal reader for Cloudflare `_headers` files (06 §6), shared by `check:dist` (rule count, line length) and the deploy
 * smoke script (the headers `/` must carry). The dev/preview replay lives in `apps/web/plugins/headers.ts`; this copy only
 * needs the block structure, so it stays dependency-free and Node-only.
 */

/** One header line of a block. `remove` marks a `! Name` line (drop the platform's value), whose `value` is empty. */
export interface HeadersEntry {
  readonly name: string;
  readonly value: string;
  readonly remove: boolean;
  /** 1-based line number. */
  readonly line: number;
}

/** One path block: its URL pattern and its header lines in file order. */
export interface HeadersBlock {
  readonly pattern: string;
  /** 1-based line number of the pattern line. */
  readonly line: number;
  readonly entries: readonly HeadersEntry[];
}

/** Cloudflare's per-header-line limit (characters). */
export const MAX_HEADER_LINE_CHARS = 2000;

/** Parses `_headers` text into blocks. Throws on a header line outside a block or a line it cannot read. */
export function parseHeadersFile(text: string): HeadersBlock[] {
  const blocks: Array<{ pattern: string; line: number; entries: HeadersEntry[] }> = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) return;
    if (!/^\s/.test(raw)) {
      blocks.push({ pattern: raw.trim(), line, entries: [] });
      return;
    }
    const block = blocks.at(-1);
    if (block === undefined) throw new Error(`_headers line ${String(line)}: header outside a path block`);
    const body = raw.trim();
    const removal = /^!\s*([\w-]+)$/.exec(body);
    const addition = /^([\w-]+)\s*:\s*(.*)$/.exec(body);
    if (removal?.[1] !== undefined) block.entries.push({ name: removal[1], value: '', remove: true, line });
    else if (addition?.[1] !== undefined && addition[2] !== undefined)
      block.entries.push({ name: addition[1], value: addition[2], remove: false, line });
    else throw new Error(`_headers line ${String(line)}: cannot parse "${body}"`);
  });
  return blocks;
}

/** The headers a block sets (lower-case name → value), ignoring removals. A later line of the same name wins. */
export function blockHeaders(block: HeadersBlock): ReadonlyMap<string, string> {
  const headers = new Map<string, string>();
  for (const entry of block.entries) if (!entry.remove) headers.set(entry.name.toLowerCase(), entry.value);
  return headers;
}
