// 递归把前端静态资源(HTML / CSS / vendor 库等)从 src/web 复制到 dist/web
// 跳过 .ts 源文件(由 tsc 编译)和 source map
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const src = path.join(root, "src", "web");
const out = path.join(root, "dist", "web");
mkdirSync(out, { recursive: true });

const isAsset = (f) => /\.(html|css|svg|png|ico|js)$/i.test(f) && !/\.map$/.test(f);

let n = 0;
function walk(dir) {
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".ts") || f.endsWith(".map")) continue;
    const full = path.join(dir, f);
    const rel = path.relative(src, full);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (isAsset(f)) {
      cpSync(full, path.join(out, rel), { recursive: true });
      n++;
    }
  }
}
walk(src);
console.log(`[copy-assets] ${n} file(s) -> ${out}`);