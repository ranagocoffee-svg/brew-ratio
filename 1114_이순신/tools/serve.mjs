// 의존성 없는 정적 서버. 프로젝트 루트를 서빙한다. 사용법: node tools/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] ?? 5173);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".md": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/web/index.html";
    const file = normalize(join(ROOT, p));
    // 루트 밖과 node_modules/.git 접근 차단
    if (!file.startsWith(ROOT + sep) || /[\\/](node_modules|\.git)[\\/]/.test(file)) { res.writeHead(403).end("forbidden"); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}/`));
