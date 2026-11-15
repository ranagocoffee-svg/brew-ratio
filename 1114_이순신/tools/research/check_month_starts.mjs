// 조사용 스크립트: 변환기(korean-lunar-calendar)의 음력 초하루를 천문 계산한 삭(New Moon)과 대조한다.
// 삭은 Meeus ch.49 주요항(오차 수 분), ΔT≈110초, 서울(UT+8:28) 기준 날짜. 실제 대통력 계산과는 다를 수 있다.
// 사용법: node tools/research/check_month_starts.mjs [시작년 끝년]   (기본 1592 1598)
import KoreanLunarCalendar from "korean-lunar-calendar";
import { jdn, ganji } from "../lunar.mjs";

const rad = (d) => (d * Math.PI) / 180;
const norm = (d) => ((d % 360) + 360) % 360;
const s = (x) => Math.sin(rad(x));

function newMoonJDE(k) {
  const T = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = norm(2.5534 + 29.1053567 * k - 0.0000014 * T * T);
  const Mp = norm(201.5643 + 385.81693528 * k + 0.0107582 * T * T);
  const F = norm(160.7108 + 390.67050284 * k - 0.0016118 * T * T);
  const Om = norm(124.7746 - 1.56375588 * k + 0.0020672 * T * T);
  jde += -0.4072 * s(Mp) + 0.17241 * E * s(M) + 0.01608 * s(2 * Mp) + 0.01039 * s(2 * F)
    + 0.00739 * E * s(Mp - M) - 0.00514 * E * s(Mp + M) + 0.00208 * E * E * s(2 * M)
    - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F) + 0.00056 * E * s(2 * Mp + M)
    - 0.00042 * s(3 * Mp) + 0.00042 * E * s(M + 2 * F) + 0.00038 * E * s(M - 2 * F)
    - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(Om);
  return jde;
}

function jdToGregorian(jd) { // 양력(proleptic)
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  const al = Math.floor((z - 1867216.25) / 36524.25);
  const A = z + 1 + al - Math.floor(al / 4);
  const B = A + 1524, C = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * C), E2 = Math.floor((B - D) / 30.6001);
  const day = B - D - Math.floor(30.6001 * E2) + f;
  const month = E2 < 14 ? E2 - 1 : E2 - 13;
  return { y: month > 2 ? C - 4716 : C - 4715, m: month, d: Math.floor(day), h: (day % 1) * 24 };
}


const DT = 110 / 86400, SEOUL = (8 + 28 / 60) / 24;
const [from, to] = [Number(process.argv[2] ?? 1592), Number(process.argv[3] ?? 1598)];
const astro = [];
for (let k = Math.floor((from - 2000) * 12.3685) - 6; k <= Math.ceil((to + 1 - 2000) * 12.3685) + 6; k++)
  astro.push(jdToGregorian(newMoonJDE(k) - DT + SEOUL));

console.log("연-월  변환기 초하루  천문 삭(서울)      차이(일)  초하루 일간지");
const cal = new KoreanLunarCalendar();
const dist = {};
for (let ly = from; ly <= to; ly++) {
  for (let m = 1; m <= 12; m++) {
    if (!cal.setLunarDate(ly, m, 1, false)) continue;
    const t = cal.getSolarCalendar();
    const lk = jdn(t.year, t.month, t.day);
    const near = astro.reduce((b, a) => (Math.abs(jdn(a.y, a.m, a.d) - lk) < Math.abs(jdn(b.y, b.m, b.d) - lk) ? a : b));
    const diff = lk - jdn(near.y, near.m, near.d);
    dist[diff] = (dist[diff] ?? 0) + 1;
    if (diff !== 0) {
      const p = (n) => String(n).padStart(2, "0");
      console.log(`${ly}-${p(m)}  ${t.year}-${p(t.month)}-${p(t.day)}  ${near.y}-${p(near.m)}-${p(near.d)} ${near.h.toFixed(1)}h  ${diff}  ${ganji(t.year, t.month, t.day)}(변환기) / ${ganji(near.y, near.m, near.d)}(천문)`);
    }
  }
}
console.log("차이 분포:", JSON.stringify(dist), "(0 이 아닌 달만 위에 표시)");
console.log("일간지 참고: 1597-10-25 =", ganji(1597, 10, 25), "/ 1597-10-26 =", ganji(1597, 10, 26));
