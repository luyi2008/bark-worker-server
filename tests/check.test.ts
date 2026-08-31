import { expect, test } from '@rstest/core';
import { API } from '../src/core/api';
import { type BasicKV, KVAdapter } from '../src/core/db/kv-adapter';
import { createHono } from '../src/core/hono';

class MemoryKV implements BasicKV {
  kv: Record<string, string> = {};
  async get(key: string, options?: { type: 'json' | 'text' }) {
    const res = this.kv[key];
    if (!res) {
      return undefined;
    }
    return options?.type === 'json' ? JSON.parse(res) : res;
  }
  async put(key: string, value: string) {
    this.kv[key] = value;
  }
  async delete(key: string) {
    delete this.kv[key];
  }
}

const VALID_KEY = 'ynJ5Ft4atkMkWeo2PAvFhF';

const createApi = () =>
  new API({
    db: new KVAdapter(new MemoryKV()),
    allowNewDevice: true,
    allowQueryNums: true,
    maxBatchPushCount: Number.NaN,
  });

const createApp = (apiDb?: KVAdapter) =>
  createHono({
    db: apiDb || new KVAdapter(new MemoryKV()),
    allowNewDevice: true,
    allowQueryNums: true,
    maxBatchPushCount: Number.NaN,
  });

test('check rejects empty key', async () => {
  const result = await createApi().check();
  expect(result.data.valid).toBe(false);
  expect(result.data.registered).toBe(false);
  expect(result.data.reason).toBe('device key is empty');
});

test('check rejects invalid length before charset', async () => {
  const result = await createApi().check('abc!');
  expect(result.data.valid).toBe(false);
  expect(result.data.reason).toBe('device key length is invalid');
});

test('check rejects invalid characters', async () => {
  const result = await createApi().check('ynJ5Ft4atkMkWeo2PAvFh-');
  expect(result.data.valid).toBe(false);
  expect(result.data.reason).toBe('device key contains invalid characters');
});

test('check reports unregistered valid key', async () => {
  const result = await createApi().check(VALID_KEY);
  expect(result.data.valid).toBe(true);
  expect(result.data.registered).toBe(false);
  expect(result.data.reason).toBeNull();
});

test('check reports registered key', async () => {
  const db = new KVAdapter(new MemoryKV());
  await db.saveDeviceTokenByKey(VALID_KEY, 'token123');
  const api = new API({
    db,
    allowNewDevice: true,
    allowQueryNums: true,
    maxBatchPushCount: Number.NaN,
  });
  const result = await api.check(VALID_KEY);
  expect(result.data.valid).toBe(true);
  expect(result.data.registered).toBe(true);
  expect(result.data.reason).toBeNull();
});

test('GET /check is not treated as v1 push', async () => {
  const app = createApp();
  const res = await app.request(`/check?device_key=${VALID_KEY}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.valid).toBe(true);
  expect(body.data.registered).toBe(false);
});

test('GET /check sets Cache-Control no-store', async () => {
  const app = createApp();
  const res = await app.request(`/check?device_key=${VALID_KEY}`);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
});

test('POST /check accepts JSON body', async () => {
  const db = new KVAdapter(new MemoryKV());
  await db.saveDeviceTokenByKey(VALID_KEY, 'token123');
  const app = createApp(db);
  const res = await app.request('/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_key: VALID_KEY }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.valid).toBe(true);
  expect(body.data.registered).toBe(true);
});
