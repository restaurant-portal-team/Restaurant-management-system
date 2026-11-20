import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUID version 7 (48-bit Unix ms timestamp + random), matching Prisma's @default(uuid(7)).
 * Needed because id columns have no database default (F02 convention): rows inserted outside
 * Prisma Client must supply their own id.
 */
export function uuidV7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
