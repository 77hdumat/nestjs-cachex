/**
 * Envelope wrapping cached data with SWR metadata.
 * Tracks logical expiry (expiresAt) independently of the physical Redis TTL.
 */
export class CacheEnvelope {
  constructor(
    public readonly data: unknown,
    public readonly createdAt: number,
    public readonly expiresAt: number,
  ) {}

  /**
   * Creates an envelope with the given logical TTL applied.
   * No jitter is added here — jitter is applied only to the physical TTL in CacheOperations.resolvePhysicalTtl().
   */
  static create(data: unknown, ttl: number): CacheEnvelope {
    const now = Date.now();
    return new CacheEnvelope(data, now, now + ttl * 1000);
  }

  static fromObject(obj: any): CacheEnvelope | null {
    if (!CacheEnvelope.isValidObject(obj)) {
      return null;
    }

    return new CacheEnvelope(obj.data, obj.createdAt, obj.expiresAt);
  }

  static isValidObject(
    obj: unknown,
  ): obj is { data: unknown; createdAt: number; expiresAt: number } {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      'data' in obj &&
      'createdAt' in obj &&
      'expiresAt' in obj &&
      typeof (obj as any).createdAt === 'number' &&
      typeof (obj as any).expiresAt === 'number'
    );
  }

  isStale(): boolean {
    return Date.now() > this.expiresAt;
  }

  isFresh(): boolean {
    return !this.isStale();
  }

  toObject(): { data: unknown; createdAt: number; expiresAt: number } {
    return {
      data: this.data,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
    };
  }
}
