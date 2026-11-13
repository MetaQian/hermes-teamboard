// 把 vendored 第三方库从 node_modules 复制到 src/web/vendor(本地加载, 无需 CDN)
// 需要先在项目根目录执行 npm install(devDependencies: d3@7, echarts@5)
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(root, "src", "web", "vendor");
mkdirSync(out, { recursive: true });

const jobs = [
  ["node_modules/d3/dist/d3.min.js", "d3.min.js"],
  ["node_modules/echarts/dist/echarts.min.js", "echarts.min.js"],
];

let n = 0;
for (const [rel, name] of jobs) {
  const from = path.join(root, rel);
  if (!existsSync(from)) {
    console.warn(`[fetch-vendor] 缺少 ${rel} — 请先在项目根目录执行 npm install`);
    continue;
  }
  copyFileSync(from, path.join(out, name));
  n++;
}
console.log(`[fetch-vendor] ${n} lib(s) -> ${out}`);