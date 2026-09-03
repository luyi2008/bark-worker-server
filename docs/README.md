# API

本仓库实现的接口：

- [Register：设备注册 / 注销](./register.md)
- [Check：校验 Bark Key 是否已注册](./check.md)

`/push`、v1 路径等与官方 Bark-Server 兼容的接口，请参见：

https://github.com/luyi2008/bark-server/tree/master/docs

`/register` 路径与参数名兼容官方，但 **device_key 由 token 哈希派生，且不允许把新 token 改绑到已有 key**。细节以 [register.md](./register.md) 为准。
