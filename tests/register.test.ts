import { expect, test } from '@rstest/core';
import { API, APIError } from '../src/core/api';
import { type BasicKV, KVAdapter } from '../src/core/db/kv-adapter';
import { createHono } from '../src/core/hono';
import { normalizeDeviceToken, shortHash } from '../src/core/utils';

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

const createApi = (db?: KVAdapter, allowNewDevice = true) =>
  new API({
    db: db || new KVAdapter(new MemoryKV()),
    allowNewDevice,
    allowQueryNums: true,
    maxBatchPushCount: Number.NaN,
  });

const createApp = (db?: KVAdapter, allowNewDevice = true) =>
  createHono({
    db: db || new KVAdapter(new MemoryKV()),
    allowNewDevice,
    allowQueryNums: true,
    maxBatchPushCount: Number.NaN,
  });

test('device key is 22-char hash of token', async () => {
  const api = createApi();
  const token = 'tokenaaa';
  const result = await api.register(token);
  const expected = await shortHash(normalizeDeviceToken(token));
  expect(expected).toHaveLength(22);
  expect(result.data.device_key).toBe(expected);
});

test('same token without key reuses device key', async () => {
  const api = createApi();
  const first = await api.register('tokenaaa');
  const second = await api.register('tokenaaa');
  expect(first.data.device_key).toBe(second.data.device_key);
  expect(first.data.device_token).toBe('tokenaaa');
});

test('existing token with another existing key returns original key', async () => {
  const api = createApi();
  const first = await api.register('tokenaaa');
  const second = await api.register('tokenbbb');

  const reused = await api.register('tokenaaa', second.data.device_key);
  expect(reused.data.device_key).toBe(first.data.device_key);

  const stillSecond = await api.check(second.data.device_key);
  expect(stillSecond.data.registered).toBe(true);
  expect(await api.db.deviceTokenByKey(second.data.device_key)).toBe(
    'tokenbbb',
  );
});

test('new token with existing key returns 500 and does not write', async () => {
  const api = createApi();
  const first = await api.register('tokenaaa');

  try {
    await api.register('tokenccc', first.data.device_key);
    throw new Error('expected register to fail');
  } catch (e) {
    expect(e).toBeInstanceOf(APIError);
    expect((e as APIError).code).toBe(500);
    expect((e as APIError).message).toBe('device key is invalid');
  }

  expect(await api.db.deviceTokenByKey(first.data.device_key)).toBe('tokenaaa');
  expect(
    await api.db.deviceTokenByKey(
      await shortHash(normalizeDeviceToken('tokenccc')),
    ),
  ).toBeUndefined();
});

test('new token without key creates device when allowed', async () => {
  const api = createApi();
  const result = await api.register('tokenaaa');
  expect(result.code).toBe(200);
  expect(result.data.device_key).toHaveLength(22);
  expect(result.data.device_token).toBe('tokenaaa');
});

test('new token without key is rejected when register disabled', async () => {
  const api = createApi(undefined, false);
  try {
    await api.register('tokenaaa');
    throw new Error('expected register to fail');
  } catch (e) {
    expect(e).toBeInstanceOf(APIError);
    expect((e as APIError).code).toBe(500);
    expect((e as APIError).message).toBe(
      'device registration failed: register disabled',
    );
  }
});

test('existing token can be reused when register disabled', async () => {
  const db = new KVAdapter(new MemoryKV());
  const token = 'tokenaaa';
  const derivedKey = await shortHash(normalizeDeviceToken(token));
  await db.saveDeviceTokenByKey(derivedKey, token);
  const api = createApi(db, false);
  const result = await api.register(token);
  expect(result.data.device_key).toBe(derivedKey);
});

test('token can register again after deleted', async () => {
  const api = createApi();
  const first = await api.register('tokenaaa');
  await api.register('deleted', first.data.device_key);

  expect(await api.db.deviceTokenByKey(first.data.device_key)).toBeUndefined();

  const second = await api.register('tokenaaa');
  expect(second.data.device_key).toBe(first.data.device_key);
  expect(second.data.device_token).toBe('tokenaaa');
});

test('POST /register returns 500 for new token with existing key', async () => {
  const db = new KVAdapter(new MemoryKV());
  const app = createApp(db);
  const created = await app.request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_token: 'tokenaaa' }),
  });
  const createdBody = await created.json();

  const res = await app.request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_token: 'tokenccc',
      device_key: createdBody.data.device_key,
    }),
  });
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body.code).toBe(500);
  expect(body.message).toBe('device key is invalid');
});
