#!/usr/bin/env node
/**
 * 安装后自检：验证 better-sqlite3 原生模块能否加载
 * Linux 上缺编译工具链时给出明确指引，而不是等到运行时才崩
 */
try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("ok");
  const row = db.prepare("SELECT v FROM t WHERE id = 1").get();
  db.close();
  if (!row || row.v !== "ok") throw new Error("内存库读写校验失败");
  console.log("[OK] better-sqlite3 原生模块加载正常");
  process.exit(0);
} catch (e) {
  console.error("----------------------------------------------------");
  console.error("[失败] better-sqlite3 无法加载");
  console.error("       " + e.message);
  console.error("----------------------------------------------------");
  console.error("平台: " + process.platform + " / " + process.arch);
  console.error("Node: " + process.version);
  if (process.platform === "linux") {
    console.error("");
    console.error("Linux 上一般是缺少编译工具链（预编译包下载失败会回退本地编译）。");
    console.error("请安装后重试：");
    console.error("  Debian/Ubuntu: sudo apt-get install -y build-essential python3");
    console.error("  CentOS/RHEL:   sudo yum groupinstall -y 'Development Tools' && sudo yum install -y python3");
    console.error("  Alpine:        apk add --no-cache python3 make g++");
    console.error("");
    console.error("然后: rm -rf node_modules && npm install");
  } else if (process.platform === "win32") {
    console.error("Windows 上多为缺少 VC++ 运行库，或 Node 版本过新无预编译包。建议 Node 20/22 LTS。");
  }
  process.exit(0);
}
