/**
 * 测试环境引导
 * 把 "@/lib/xxx" 解析到 "../lib/xxx"
 */
const path = require("path");
const Module = require("module");

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const rel = request.slice(2);
    // 优先 lib/
    const candidates = [
      path.join(__dirname, "..", "..", rel),
      path.join(__dirname, "..", "..", rel + ".ts"),
      path.join(__dirname, "..", "..", rel, "index.ts"),
    ];
    for (const c of candidates) {
      try {
        return origResolve.call(this, c, parent, isMain, options);
      } catch {}
    }
  }
  return origResolve.call(this, request, parent, isMain, options);
};
