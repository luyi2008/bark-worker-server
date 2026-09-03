# Register

注册或注销设备：把 APNs `device_token` 绑定到本服务的 Bark Key（`device_key`）。

路径受 `URL_PREFIX` 影响。例如 `URL_PREFIX=/bark` 时，实际路径为 `/bark/register`。

本实现与官方 Bark-Server 的路径、参数名兼容，但 **key 的生成与绑定规则不同**，见下文 [与官方差异](#与官方差异)。

响应一律带 `Cache-Control: no-store`，避免边缘节点缓存注册结果。

## Request

| Method | Path | 参数位置 |
| ------ | ---- | -------- |
| GET | `/register` | Query |
| POST | `/register` | JSON / 表单 |

| 字段 | 别名 | 必填 | 说明 |
| --- | --- | --- | --- |
| `device_token` | `devicetoken` | 是 | APNs 设备 token。值为字面量 `deleted` 时表示注销，见 [注销](#注销) |
| `device_key` | `key` | 否 | 已有 Bark Key。新注册时**不会**采用该值作为存储 key，只用于注销或拦截“把新 token 绑到已有 key” |

token 长度上限为 **128**（超出返回 `400 device token is invalid`）。空 token 返回 `400 device token is empty`。

## Key 如何生成

`device_key` 由 token 派生，同一 token 始终得到同一 key：

1. 规范化：去掉所有非 `[a-z0-9]` 字符（**大写字母也会被去掉**，只保留小写字母和数字）
2. 对该字符串做 SHA-256 短哈希，得到 **22** 位 `[a-zA-Z0-9]`（并去掉易混字符 `l`、`I`、`O`、`0`、`1`）

写入 KV 时同样按第 1 步规范化 token。APNs token 请用小写十六进制，避免大写字母被剥掉后无法推送。

因此：

- 不传 `device_key` 时，key 也是确定的，不是随机 UUID
- 同一 token 重复注册会直接返回已有 key，不会新建记录
- `ALLOW_NEW_DEVICE=false` 时，**已注册过的 token 仍可再次注册**（相当于查询/续期），只有从未出现过的 token 会被拒绝

KV 写入有延迟，注册成功后可能要过几秒才能推送（见仓库 README「已知问题」）。

## 行为

按以下顺序处理，命中即返回：

1. `device_token` 为空 → `400` `device token is empty`
2. `device_token` 长度 `> 128` → `400` `device token is invalid`
3. `device_token` 恰好为 `deleted` → 走 [注销](#注销)
4. 用 token 算出 `derivedKey`；若 `derivedKey` 已在库中 → `200`，返回该 key 与请求中的 token（忽略传入的 `device_key`）
5. 若传入的 `device_key` 已在库中（且第 4 步未命中，即这是**新 token**）→ `500` `device key is invalid`，不写库
6. 若 `ALLOW_NEW_DEVICE` 为 `false` → `500` `device registration failed: register disabled`
7. 否则写入 `derivedKey → token`，返回 `200`

| 情况 | HTTP / code | message |
| --- | --- | --- |
| 新 token，允许注册 | 200 | success |
| 已存在的 token（无论是否关闭新设备注册） | 200 | success |
| 已存在的 token + 另一个已存在的 key | 200 | success（仍返回该 token 自己的 key，另一个 key 不受影响） |
| 新 token + 已存在的 key | 500 | `device key is invalid` |
| 新 token，且关闭新设备注册 | 500 | `device registration failed: register disabled` |
| token 为空 | 400 | `device token is empty` |
| token 过长 | 400 | `device token is invalid` |

## 注销

当 `device_token`（或 `devicetoken`）为字面量 `deleted`：

- 若传入的 `device_key` / `key` 已在库中：删除该记录，返回该 key，`device_token` 为 `deleted`
- 若未传入 key、或 key 不存在：
  - `ALLOW_NEW_DEVICE=true`：生成一个随机 22 位 key（不写入），再按该 key 执行删除，返回该随机 key
  - `ALLOW_NEW_DEVICE=false`：`500` `device registration failed: register disabled`

注销后，同一 token 再次注册会得到**原来的**派生 key（因为 key 由 token 哈希决定）。

没有官方的 `GET /register/:device_key`。要查询 key 是否已注册，请用 [`/check`](./check.md)。

## Response

成功：

```json
{
  "code": 200,
  "message": "success",
  "timestamp": 1730000000,
  "data": {
    "key": "ynJ5Ft4atkMkWeo2PAvFhF",
    "device_key": "ynJ5Ft4atkMkWeo2PAvFhF",
    "device_token": "tokenaaa"
  }
}
```

`key` 与 `device_key` 相同，前者兼容旧客户端。

失败时 HTTP 状态码与 `code` 一致，无 `data`：

```json
{
  "code": 500,
  "message": "device key is invalid",
  "timestamp": 1730000000
}
```

## 与官方差异

相对 [Bark-Server](https://github.com/Finb/bark-server) /register：

| | 官方 | 本仓库 |
| --- | --- | --- |
| 未传 key 时 | 随机 UUID | token 的 22 位短哈希，可复现 |
| 传入已有 key + 新 token | 把该 key 改绑到新 token | `500 device key is invalid` |
| token 长度上限 | 160 | 128 |
| 查询是否已注册 | `GET /register/:device_key` | [`GET/POST /check`](./check.md) |
| 关闭新设备 | 由服务端配置控制新写入 | 配置项 `ALLOW_NEW_DEVICE`，已存在 token 仍可注册 |

Bark App 更换 APNs token 时若仍带上旧 `device_key`，本服务会拒绝改绑。客户端应使用新 token 对应的派生 key（或不传 key，让服务端按 token 计算）。

## curl

```sh
curl "http://127.0.0.1:8080/register?device_token=tokenaaa"
```

```sh
curl -X POST "http://127.0.0.1:8080/register" \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d '{"device_token": "tokenaaa"}'
```

注销：

```sh
curl -X POST "http://127.0.0.1:8080/register" \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d '{"device_token": "deleted", "device_key": "ynJ5Ft4atkMkWeo2PAvFhF"}'
```
