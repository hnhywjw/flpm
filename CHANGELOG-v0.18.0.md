# 改密后仍提示「使用初始密码」—— 第二次修复

日期：2026-10-29 14:40

---

## 一、这次的真实原因

上一轮修的是「迁移脚本反复覆盖标记」，那个问题确实修好了（王经理的 0 一直保持）。

但你说改完 admin 密码还提示，说明**还有第二个原因**。

### 定位

查 admin 状态：

```
admin  must_change_pwd = 1
last_login_at = 2026-10-29 14:35:25
密码审计记录 = 0 条
```

迁移已登记 21 个（不会再重跑），所以不是覆盖问题。**问题在改密走的通道。**

### 两条改密通道，行为不同

| 入口 | 接口 | 是否标记需改密 |
|---|---|---|
| 设置 → 修改密码 | /api/auth/change-password | 否（清 0）|
| 人员管理 → 修改密码 | /api/admin/roles 的 resetPassword | **是（设 1）** |

`resetUserPassword()` 的实现：

```ts
run(
  "UPDATE users SET password_hash=?, password_salt=?, must_change_pwd = 1 WHERE id=?",
  [hash, salt, userId]
);
```

**这是给「管理员帮别人重置」设计的**——被重置的人下次登录要自己再改一次，符合安全规范。

但你在「人员管理」里给自己改密码，走的也是这条路径，
结果：改完密码 → 标记设成 1 → 登录又提示 → 你再去改 → 又设成 1，死循环。

---

## 二、修复

### 1. 后端：改自己时不标记

```ts
case "resetPassword": {
  const targetId = Number(body.id);
  resetUserPassword(targetId, hash, salt);

  // 管理员给自己改密码时，不该再标记「必须改密」
  if (targetId === user.id) {
    run("UPDATE users SET must_change_pwd = 0 WHERE id = ?", [targetId]);
  }
  return NextResponse.json({ ok: true });
}
```

### 2. 前端：改完横幅立即消失

原来横幅只在页面加载时检查一次，改完密码得手动刷新才消失。

现在加了事件通知：

```ts
// 改密成功后
window.dispatchEvent(new Event("pwd-changed"));

// AppShell 的横幅监听
window.addEventListener("pwd-changed", check);
```

---

## 三、验证（8/8 通过）

| 步骤 | 结果 |
|---|---|
| admin 用测试密码登录 | 200 |
| 登录后 me 显示需改密 | True（符合预期）|
| 人员管理里给自己改密 | 200 |
| **改完 must_change_pwd** | **0** |
| 用新密码登录 | 200 |
| me 返回需改密 | **False** |
| 页面安全提醒横幅 | **消失** |
| 帮他人重置（李慧） | 200，标记 **1** |

### 关键设计：两种场景区分开

```
自己改自己     → 标记 0，改完即用，不打扰
管理员改别人   → 标记 1，对方下次登录需自己改
```

---

## 四、当前各账号状态

```
系统       正常   （不参与登录）
王经理     正常   （已改过密码）
管理员     正常   （已改过密码）
王海涛     需改密 （仍是初始密码 Admin@123）
李慧       需改密
张立群     需改密
刘鹏       需改密
陈静       需改密
赵磊       需改密
赵敏       需改密
孙浩       需改密
```

后 8 个确实还在用初始密码，提示是对的。他们各自改完密码后就不会再提示。

---

## 五、以后怎么改自己的密码

```
方式 A：设置 → 修改密码        （需要输入原密码）
方式 B：人员管理 → 修改密码     （管理员权限，不需要原密码）
```

两者现在都不会再给你设「必须改密」的标记。

---

## 六、变更清单

```
修改：
  app/api/admin/roles/route.ts    resetPassword 区分「改自己」和「改别人」
  components/AppShell.tsx         横幅监听 pwd-changed 事件
  app/settings/ChangePassword.tsx 改密成功后派发事件
  app/settings/RoleAdmin.tsx      给自己改密后派发事件
```
