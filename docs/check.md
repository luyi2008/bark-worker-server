# Check

校验 `device_key`（Bark Key）格式是否合法，以及该 key 是否已在本服务注册。

格式不合法时不会查询数据库。HTTP 状态码始终为 `200`（服务端异常除外），结果写在 `data` 中。

路径受 `URL_PREFIX` 影响。例如 `URL_PREFIX=/bark` 时，实际路径为 `/bark/check`。

## Request

| Method | Path | 参数位置 |
| ------ | ---- | -------- |
| GET | `/check` | Query：`device_key` 或 `key` |
| POST | `/check` | JSON / 表单：`device_key` 或 `key` |

## Validation

按以下顺序校验，任一失败即停止，不再查库：

1. 空值
2. 长度必须为 **22**
3. 字符必须全部为 `[a-zA-Z0-9]`
4. 查询是否已注册

## Response

```json
{
  "code": 200,
  "message": "success",
  "timestamp": 1730000000,
  "data": {
    "device_key": "ynJ5Ft4atkMkWeo2PAvFhF",
    "valid": true,
    "registered": true,
    "reason": null
  }
}
```

| 情况 | valid | registered | reason |
| --- | --- | --- | --- |
| 为空 | false | false | `device key is empty` |
| 长度不对 | false | false | `device key length is invalid` |
| 含非法字符 | false | false | `device key contains invalid characters` |
| 格式合法且已注册 | true | true | null |
| 格式合法但未注册 | true | false | null |

## curl

```sh
curl "http://127.0.0.1:8080/check?device_key=ynJ5Ft4atkMkWeo2PAvFhF"
```

```sh
curl -X POST "http://127.0.0.1:8080/check" \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d '{"device_key": "ynJ5Ft4atkMkWeo2PAvFhF"}'
```
