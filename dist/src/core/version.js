// core/version.ts —— 版本号单一来源：从 package.json 现读（find-up），永不再硬编码漂移。
// dist/bin/*.js 与 bin/*.ts 两种布局深度不同，向上找直到命中 name=jixiaops 的 package.json。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let cached = null;
export function pkgVersion() {
    if (cached)
        return cached;
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
        try {
            const j = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
            if (j.name === "jixiaops" && j.version)
                return (cached = j.version);
        }
        catch { /* 不是包根，继续向上 */ }
        dir = path.dirname(dir);
    }
    return (cached = "unknown");
}
