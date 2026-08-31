import type { DBAdapter } from '../type';

export interface BasicKV {
  get(key: string, options?: { type: 'json' | 'text' }): Promise<any>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class KVAdapter implements DBAdapter {
  kv: BasicKV;
  /** Same-isolate write-through so register then check does not miss KV lag. */
  private recent = new Map<string, { value: string | null; expireAt: number }>();
  private static readonly RECENT_TTL_MS = 60_000;

  constructor(kv: BasicKV) {
    if (!kv) {
      throw new Error('kv database not found');
    }
    this.kv = kv;
  }

  private remember(key: string, value: string | null) {
    this.recent.set(key, {
      value,
      expireAt: Date.now() + KVAdapter.RECENT_TTL_MS,
    });
  }

  private fromRecent(key: string) {
    const entry = this.recent.get(key);
    if (!entry) {
      return { hit: false as const };
    }
    if (entry.expireAt <= Date.now()) {
      this.recent.delete(key);
      return { hit: false as const };
    }
    return {
      hit: true as const,
      value: entry.value === null ? undefined : entry.value,
    };
  }

  /**
   * ESA EdgeKV defaults to a ReadableStream when `type` is omitted, and some
   * runtimes ignore `{ type: 'text' }`. Always normalize to a string and
   * fall back to an untyped get when the typed read misses.
   */
  private async toText(value: unknown): Promise<string | undefined> {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (
      typeof value === 'object' &&
      typeof (value as ReadableStream).getReader === 'function'
    ) {
      return await new Response(value as BodyInit).text();
    }
    if (value instanceof ArrayBuffer) {
      return new TextDecoder().decode(value);
    }
    return undefined;
  }

  private async getText(key: string) {
    const cached = this.fromRecent(key);
    if (cached.hit) {
      return cached.value;
    }
    const typed = await this.toText(await this.kv.get(key, { type: 'text' }));
    if (typed) {
      return typed;
    }
    return this.toText(await this.kv.get(key));
  }

  async countAll() {
    const c = Number(await this.getText('deviceCount'));
    return Number.isNaN(c) ? 0 : c;
  }
  async updateCount(diff: number) {
    const count = await this.countAll();
    const next = String(count + diff);
    await this.kv.put('deviceCount', next);
    this.remember('deviceCount', next);
  }

  async deviceTokenByKey(key: string) {
    const deviceKey =
      (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_';
    return this.getText(`device_${deviceKey}`);
  }

  async saveDeviceTokenByKey(key: string, token: string) {
    if (!token) {
      return this.deleteDeviceByKey(key);
    }
    const deviceToken = (token || '').replace(/[^a-z0-9]/g, '') || '';
    const k = `device_${key}`;
    const existing = await this.getText(k);
    if (!existing) {
      await this.updateCount(1);
    }
    await this.kv.put(k, deviceToken);
    this.remember(k, deviceToken);
  }

  async deleteDeviceByKey(key: string) {
    const deviceKey =
      (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_';
    await this.updateCount(-1);
    const k = `device_${deviceKey}`;
    this.remember(k, null);
    return this.kv.delete(k);
  }

  async saveAuthorizationToken(token: string, ttl: number) {
    const expireAt = Date.now() + ttl;
    await this.kv.put('authToken', JSON.stringify({ token, expireAt }));
  }

  async getAuthorizationToken() {
    const res = await this.kv.get('authToken');
    if (!res || res.expireAt > Date.now()) {
      return undefined;
    }
    return res.token;
  }
}
