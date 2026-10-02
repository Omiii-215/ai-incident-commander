import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@aic/contracts';
import { hashCanonical } from '@aic/domain';

// Opaque, tamper-checked cursors. Stream cursors bind workspace + sequence;
// list cursors bind workspace, filter/sort hash and the last sort tuple
// (API_CONTRACTS.md §1, §6). A cursor is never an authorization credential.

export class CursorCodec {
  constructor(private readonly key: string) {
    if (key.length < 16) throw new Error('Cursor signing key must be at least 16 characters.');
  }

  private sign(body: string) {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }

  encode(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  decode(cursor: string): Record<string, unknown> {
    const [body, sig] = cursor.split('.');
    if (!body || !sig) throw new AppError('INVALID_CURSOR', 'The cursor is malformed.');
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new AppError('INVALID_CURSOR', 'The cursor is malformed.');
    }
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new AppError('INVALID_CURSOR', 'The cursor is malformed.');
    }
  }

  encodeStream(workspaceId: string, seq: number): string {
    return this.encode({ v: 1, k: 's', w: workspaceId, s: seq });
  }

  decodeStream(cursor: string, workspaceId: string): number {
    const p = this.decode(cursor);
    if (p.v !== 1 || p.k !== 's' || typeof p.s !== 'number' || !Number.isSafeInteger(p.s) || p.s < 0) {
      throw new AppError('INVALID_CURSOR', 'The stream cursor is malformed.');
    }
    if (p.w !== workspaceId) throw new AppError('INVALID_CURSOR', 'The stream cursor does not belong to this workspace.');
    return p.s;
  }

  encodeList(workspaceId: string, filter: unknown, last: unknown[]): string {
    return this.encode({ v: 1, k: 'l', w: workspaceId, f: hashCanonical(filter ?? null), t: last });
  }

  decodeList(cursor: string, workspaceId: string, filter: unknown): unknown[] {
    const p = this.decode(cursor);
    if (p.v !== 1 || p.k !== 'l' || p.w !== workspaceId || !Array.isArray(p.t)) {
      throw new AppError('INVALID_CURSOR', 'The page cursor is invalid for this list.');
    }
    if (p.f !== hashCanonical(filter ?? null)) {
      throw new AppError('INVALID_CURSOR', 'The page cursor was created for different filters.');
    }
    return p.t;
  }
}
