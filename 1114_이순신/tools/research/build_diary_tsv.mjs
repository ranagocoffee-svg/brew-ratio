// 국가유산포털 원문 줄(book<N>.json) -> 일별 일기 분할 -> 입력 시트(TSV).
// 분할 기준: '<날짜>日<일간지>' 머리. 일간지가 앞 항목의 다음 날(+1)인지로 가짜 머리를 걸러낸다.
// 사용법: node tools/research/build_diary_tsv.mjs <책번호> <시작 음력 월> <출력.tsv> [--report]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [bookArg, startMonthArg, outArg] = process.argv.slice(2);
const report = process.argv.includes("--report");
const book = JSON.parse(readFileSync(join(ROOT, "data", "input", "heritage", `book${bookArg}.json`), "utf-8"));

const GAN = "甲乙丙丁戊己庚辛壬癸", JI = "子丑寅卯辰巳午未申酉戌亥";
const gIdx = (s) => { for (let i = 0; i < 60; i++) if (GAN[i % 10] === s[0] && JI[i % 12] === s[1]) return i; return -1; };
const DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function dayNum(tok) {
  const t = tok.replace(/^初/, "");
  if (t === "十") return 10;
  if (t === "二十") return 20;
  if (t === "三十") return 30;
  if (/^十./.test(t)) return 10 + DIGIT[t[1]];
  if (/^二十./.test(t)) return 20 + DIGIT[t[2]];
  if (/^[廿卄念]./.test(t)) return 20 + (DIGIT[t[1]] ?? 0);
  if (/^[廿卄念]$/.test(t)) return 20;
  return DIGIT[t] ?? NaN;
}
const HEAD = /(初?[一二三四五六七八九]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|[廿卄念][一二三四五六七八九]?|三十)日([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])/g;

// 문자 스트림(쪽 추적). 줄은 공백 없이 이어 붙인다(지면 줄바꿈은 문장 중간일 수 있음).
// 포털은 펼침면(2쪽) 단위로 보여주므로 인접한 두 쪽 요청이 같은 줄을 돌려준다. 동일한 줄 목록은 한 번만 쓴다.
let stream = "";
const pageAt = [];
let prevKey = null, dupSkipped = 0;
for (const pg of book.pages) {
  const key = JSON.stringify(pg.lines);
  if (key === prevKey) { dupSkipped += 1; continue; }
  prevKey = key;
  for (const line of pg.lines) {
    for (const ch of line) { stream += ch; pageAt.push(pg.page); }
  }
}

const cands = [...stream.matchAll(HEAD)].map((m) => ({ pos: m.index, len: m[0].length, tok: m[1], ganji: m[2], day: dayNum(m[1]), idx: gIdx(m[2]) }));
const entries = [];
const anomalies = [];
let last = null, month = Number(startMonthArg);
const startDay = Number(process.argv[5] && !process.argv[5].startsWith("--") ? process.argv[5] : 1);
for (const c of cands) {
  if (c.idx < 0 || Number.isNaN(c.day)) continue;
  if (!last && c.day !== startDay) continue; // 책 앞부분의 가짜 머리 건너뜀: 시작 일자(기본 1일)부터 사슬 시작
  if (last) {
    // 1차 기준은 날짜 번호: 직전 +1~+3일(미기재일 허용) 또는 월 경계(직전 ≥27일, 이번 ≤3일).
    // 일기 자체의 일간지 오기가 있을 수 있으므로 일간지는 2차(이상 징후 기록)로만 쓴다.
    const dd = c.day - last.day;
    const rollover = last.day >= 27 && c.day <= 3;
    const forward = dd >= 1 && dd <= 3;
    if (!forward && !rollover) { anomalies.push(`가짜 머리로 판단 제외: ${c.tok}日${c.ganji} @${c.pos} (직전 ${last.day}일 ${last.ganji}, 일자 간격 ${dd})`); continue; }
    const step = (c.idx - last.idx + 60) % 60;
    const gap = rollover ? null : dd; // 월 경계는 달 길이(29/30)를 알 수 없어 간격 비교 불가
    if (rollover) month += 1;
    if (gap !== null && step !== gap) anomalies.push(`일간지 불연속: ${last.day}일 ${last.ganji} -> ${c.day}일 ${c.ganji} (일자 +${gap}, 간지 +${step}) — 일기의 간지 오기 또는 판독 오류 후보`);
    else if (gap !== null && gap > 1) anomalies.push(`일기 건너뜀: ${last.day}일 -> ${c.day}일 (${gap - 1}일 미기재)`);
    else if (rollover && step > 2) anomalies.push(`월 경계 간지 간격 ${step}: ${last.month ?? month - 1}월 ${last.day}일 ${last.ganji} -> ${month}월 ${c.day}일 ${c.ganji}`);
  }
  entries.push({ ...c, month });
  last = c;
}
entries.forEach((e, i) => {
  const next = entries[i + 1];
  e.text = stream.slice(e.pos + e.len, next ? next.pos : stream.length).replace(/^\s+|\s+$/g, "");
  e.pageFrom = pageAt[e.pos];
  e.pageTo = pageAt[Math.max(e.pos, (next ? next.pos : stream.length) - 1)];
});

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
const volume = { 5: "5책 정유일기", 6: "6책 속정유일기" }[bookArg] ?? `${bookArg}책`;
const rows = entries.map((e) => [e.month, e.day, "", "", e.ganji, esc(e.text), "", `국가유산포털 원문텍스트 ${volume} ${e.pageFrom === e.pageTo ? e.pageFrom : `${e.pageFrom}~${e.pageTo}`}쪽`, ""].join("\t"));
const header = [
  `# 국가유산포털 원문텍스트(${volume}) 자동 분할 결과. 생성: tools/research/build_diary_tsv.mjs`,
  "# 본문은 포털 텍스트 그대로(줄바꿈 제거). 판독 주체와 이용 조건 미확인.",
  "lunar_month\tlunar_day\tleap\tgregorian\tday_ganji\ttext_han\ttext_ko\tsource_ref\tnote",
];
if (outArg) writeFileSync(resolve(outArg), [...header, ...rows].join("\n") + "\n", "utf-8");

console.log(`책 ${bookArg}: 일기 ${entries.length}일 분할 (시작 ${startMonthArg}월)`);
if (entries.length) console.log(`첫: ${entries[0].month}/${entries[0].day} ${entries[0].ganji} | 끝: ${entries.at(-1).month}/${entries.at(-1).day} ${entries.at(-1).ganji}`);
console.log(`이상 징후 ${anomalies.length}건`);
anomalies.forEach((a) => console.log(" -", a));
if (report) entries.forEach((e) => console.log(`${e.month}/${e.day} ${e.ganji} p${e.pageFrom}-${e.pageTo} len=${e.text.length}`));
