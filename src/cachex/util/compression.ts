import { compress, decompress } from '@mongodb-js/zstd';
import { pack, unpack } from 'msgpackr';

import type { CompressionConfig } from '../core';
import { DEFAULT_CONFIG } from '../core';

const COMPRESSED_PREFIX = '__ZS__';

export interface CompressionResult {
  data: string;
  compressed: boolean;
}

function isCompressed(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return value.startsWith(COMPRESSED_PREFIX);
}

export async function compressIfNeeded(
  value: unknown,
  config?: CompressionConfig,
): Promise<CompressionResult> {
  const enabled = config?.enabled ?? DEFAULT_CONFIG.compression.enabled;
  const threshold = config?.threshold ?? DEFAULT_CONFIG.compression.threshold;
  const level = config?.level ?? DEFAULT_CONFIG.compression.level;

  const packedBuffer = pack(value);

  if (!enabled || packedBuffer.length < threshold) {
    return {
      data: packedBuffer.toString('base64'),
      compressed: false,
    };
  }

  try {
    const compressedBuffer = await compress(packedBuffer, level);

    return {
      data: COMPRESSED_PREFIX + compressedBuffer.toString('base64'),
      compressed: true,
    };
  } catch {
    // fallback to uncompressed on compression error
    return {
      data: packedBuffer.toString('base64'),
      compressed: false,
    };
  }
}

export async function decompressIfNeeded<T>(value: unknown): Promise<T> {
  if (typeof value !== 'string') {
    return value as T;
  }

  if (isCompressed(value)) {
    const compressedBase64 = value.slice(COMPRESSED_PREFIX.length);
    const compressedBuffer = Buffer.from(compressedBase64, 'base64');
    const decompressedBuffer = await decompress(compressedBuffer);

    return unpack(decompressedBuffer) as T;
  }

  try {
    // legacy: support plain JSON values stored before msgpack was introduced
    return JSON.parse(value) as T;
  } catch {
    try {
      const buffer = Buffer.from(value, 'base64');
      return unpack(buffer) as T;
    } catch {
      return value as unknown as T;
    }
  }
}
