# v0.9.2 更新说明

---

## 1. 系统负载：存储空间监控

### 采集方式

优先用 Node 原生 `fs.statfsSync`（Node 18.15+），不依赖外部命令；失败则降级到 `df -Pk`（POSIX 格式，字段位置稳定）。

```ts
// 方案 1：原生
const st = fs.statfsSync(p);
const total = st.blocks * st.bsize;
const used  = (st.blocks - st.bfree) * st.bsize;
const free  = st.bavail * st.bsize;

// 方案 2：降级
df -Pk /app/db
```

### 监控对象

| 目录 | 用途 | 为什么重要 |
|---|---|---|
| `db/` | 数据库 | 写满会直接导致业务崩（SQLite 无法写入） |
| `uploads/` | 附件存储 | 上传失败 |
| `db/backup/` | 数据备份 | 备份写满，等于失去灾备能力 |
| `db/upgrade/` | 升级包 | 升级失败 |

### 展示内容

分区水位（按分区去重）：

```
分区 /app/db  /dev/mapper/ubuntu--vg-ubuntu--lv
  103687 MB / 148086 MB        70%   剩余 36805 MB
```

业务目录占用（逐个目录）：

| 目录 | 用途 | 占用 | 所在分区 | 分区水位 |
|---|---|---|---|---|
| /app/db | 数据库 | 7.2 MB | /app/db | 70% |
| /app/uploads | 附件存储 | 0.0 MB | /app/uploads | 70% |
| /app/db/backup | 数据备份 | 6.5 MB | /app/db | 70% |
| /app/db/upgrade | 升级包 | 0.0 MB | /app/db | 70% |

### 阈值与配色

| 条件 | 颜色 |
|---|---|
| 使用率 < 65% | 绿色 |
| 使用率 >= 65% | 黄色 |
| 使用率 >= 85% | 红色 |
| 剩余 < 5GB | 红色（不管百分比） |

### 踩的坑：bind mount 导致分区重复显示

第一版按挂载点去重，结果界面显示了两条一模一样的磁盘：

```
/app/db      103483/148086 MB  70%
/app/uploads 103483/148086 MB  70%   <- 同一块盘，重复
```

原因：bind mount 下 df 会把挂载点显示成目录本身：

```
$ df -Pk /app/db
/dev/mapper/ubuntu--vg-ubuntu--lv  ...  /app/db

$ df -Pk /app/uploads
/dev/mapper/ubuntu--vg-ubuntu--lv  ...  /app/uploads   <- 设备相同！
```

两个目录是同一条设备，但挂载点不同。

修复：按设备名去重，不是挂载点。

```ts
const key = device || mount;
if (!deviceMap.has(key)) { ... }
```

修完后正确显示 1 个分区 + 4 个目录明细。

---

## 2. 侧栏版本文案

```
改前：版本号：v0.9.0
改后：当前版本：v0.9.0
```

与「软件升级」页的「当前版本」保持一致。

---

## 验证结果

| 项目 | 结果 |
|---|---|
| 单元测试 | 163/163（新增 8）|
| 类型检查 | 零错误 |
| 存储采集 | 1 分区 / 4 目录 |
| 分区容量 | 103687/148086 MB，70%，剩余 36805 MB |
| 设备名 | /dev/mapper/ubuntu--vg-ubuntu--lv |
| 目录占用 | 数据库 7.2MB / 备份 6.5MB |
| 版本文案 | 当前版本：v0.9.0 |
| 8 个页面 | 全部 200 |
| 错误日志 | 0 条 |

## 说明

容器看到的是宿主机分区容量。

`db/` 和 `uploads/` 通过 bind mount 挂进容器，所以 statfs 返回的是宿主机对应分区的容量。这正是需要的——它就是真实的磁盘水位。

目录大小统计有深度限制。

`dirSizeMB` 递归最多 6 层，防止深层目录拖慢接口。如果将来 uploads 目录层级很深，统计值可能偏小。
