#!/usr/bin/env node
/**
 * 备份调度器：每 6 小时备份一次
 */
const { execFile } = require("child_process");

function runBackup() {
  execFile("node", ["/app/scripts/backup.js"], (err, stdout, stderr) => {
    if (err) console.error("[backup-scheduler]", stderr || err.message);
    else if (stdout) console.log(stdout.trim());
  });
}

setTimeout(() => {
  runBackup();
  setInterval(runBackup, 6 * 3600 * 1000);
}, 5 * 60 * 1000);

console.log("[backup-scheduler] 已启动（每 6 小时备份）");
