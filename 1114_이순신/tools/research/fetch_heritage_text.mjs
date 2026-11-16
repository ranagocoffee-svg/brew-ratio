// 국가유산포털 '기록유산 원문 > 원문텍스트'(국보 제76호 난중일기)를 쪽별 줄 단위로 저장한다.
// 사용법: node tools/research/fetch_heritage_text.mjs <책번호 1-9> [--delay 600]
// 출력: data/input/heritage/book<N>.json  (쪽별 원문 줄, 가공 없음)
// 주의: 이용 조건(저작권정책·공공누리 유형)은 확인 전이다. 공개·배포 전에 포털 안내를 확인할 것.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "https://www.heritage.go.kr/heri/mem/selectTextDetail.do";
const book = Number(process.argv[2]);
const delay = Number(process.argv[process.argv.indexOf("--delay") + 1] || 600);
if (!(book >= 1 && book <= 9)) { console.error("사용법: node tools/research/fetch_heritage_text.mjs <1-9>"); process.exit(2); }

const q = (page) => `${BASE}?s_code1=00&s_code2=&s_code3=00&query=${encodeURIComponent("난중일기")}&s_mnm=&s_kdcd=11&s_asno=00760000&s_from_asno=&s_to_asno=&s_ctcd=00&s_dcd=00&s_pcd=00&s_cnum=${String(book).padStart(4, "0")}&searchPageSize=5&listGubun=text&pageNo=2_1_1_0&s_page=${page}&searchPage=${page}&searchDisp=1&pageIndex=1`;
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&middot;/g, "·").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(page) {
  const res = await fetch(q(page), { headers: { "User-Agent": "Mozilla/5.0 (research; personal archive project)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (page ${page})`);
  return res.text();
}

const first = await get(1);
const total = Number(/data\.total = '(\d+)'/.exec(first)?.[1]);
if (!total) throw new Error("총 쪽수를 찾지 못함");
console.log(`책 ${book}: 총 ${total}쪽`);

const pages = [];
for (let p = 1; p <= total; p++) {
  const html = p === 1 ? first : await get(p);
  const label = /heritage-document-page[^>]*>\s*<strong>\s*([^<]*?)\s*<\/strong>/.exec(html)?.[1] ?? `${p}쪽`;
  const lines = [...html.matchAll(/<p class="horizontal_text">([\s\S]*?)<\/p>/g)].map((m) => strip(m[1]));
  pages.push({ page: p, label, lines });
  process.stdout.write(`\r${p}/${total}`);
  if (p < total) await sleep(delay);
}
console.log();

const out = join(ROOT, "data", "input", "heritage");
mkdirSync(out, { recursive: true });
const file = join(out, `book${book}.json`);
writeFileSync(file, JSON.stringify({
  source: "국가유산포털 기록유산 원문 > 국보 제76호 이순신 난중일기 및 서간첩 임진장초 > 원문텍스트",
  source_url: `${BASE}?s_asno=00760000&s_cnum=${String(book).padStart(4, "0")}`,
  book, total, fetched_at: new Date().toISOString().slice(0, 10),
  note: "초고본 정자화 텍스트. 판독 주체·이용 조건 미확인. 줄은 원고 지면 줄 그대로(가공 없음).",
  pages,
}, null, 1) + "\n", "utf-8");
console.log("저장:", file);
