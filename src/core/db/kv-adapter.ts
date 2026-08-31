import type { DBAdapter } from '../type';

export interface BasicKV {
  get(key: string, options?: { type: 'json' | 'text' }): Promise<any>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class KVAdapter implements DBAdapter {
  kv: BasicKV;
  constructor(kv: BasicKV) {
    if (!kv) {
      throw new Error('kv database not found');
    }
    this.kv = kv;
  }

  async countAll() {
    const c = Number(await this.kv.get('deviceCount'));
    return Number.isNaN(c) ? 0 : c;
  }
  async updateCount(diff: number) {
    const count = await this.countAll();
    await this.kv.put('deviceCount', String(count + diff));
  }

  async deviceTokenByKey(key: string) {
    const deviceKey =
      (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_';
    const devices = await this.kv.get(`device_${deviceKey}`, { type: 'text' });
    return devices;
  }

  async deviceKeyByToken(token: string) {
    const deviceToken = (token || '').replace(/[^a-z0-9]/g, '');
    if (!deviceToken) {
      return undefined;
    }
    return this.kv.get(`token_${deviceToken}`, { type: 'text' });
  }

  async saveDeviceTokenByKey(key: string, token: string) {
    if (!token) {
      return this.deleteDeviceByKey(key);
    }
    const deviceToken = (token || '').replace(/[^a-z0-9]/g, '') || '';
    const k = `device_${key}`;
    const existing = await this.kv.get(k, { type: 'text' });
    if (!existing) {
      await this.updateCount(1);
    } else if (existing !== deviceToken) {
      await this.kv.delete(`token_${existing}`);
    }
    await this.kv.put(k, deviceToken);
    await this.kv.put(`token_${deviceToken}`, key);
  }

  async deleteDeviceByKey(key: string) {
    const deviceKey =
      (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_';
    const token = await this.kv.get(`device_${deviceKey}`, { type: 'text' });
    if (token) {
      await this.kv.delete(`token_${token}`);
    }
    await this.updateCount(-1);
    return this.kv.delete(`device_${deviceKey}`);
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
