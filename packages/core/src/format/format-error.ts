/**
 * `FormatError { section, offset, reason }` (04 §5): a TSBV1 container that cannot be read. The Worker reports it as
 * `error.code = 'format'` (not retryable: the asset must be rebuilt).
 */
export class FormatError extends Error {
  /** FourCC of the section being read (`HEAD` for the container header). */
  readonly section: string;
  /** Byte offset in the container (or in the section payload for `PCES` built from a bare payload). */
  readonly offset: number;
  /** Human-readable cause. */
  readonly reason: string;

  constructor(section: string, offset: number, reason: string) {
    super(`TSBV1 ${section} at byte ${String(offset)}: ${reason}`);
    this.name = 'FormatError';
    this.section = section;
    this.offset = offset;
    this.reason = reason;
  }
}
