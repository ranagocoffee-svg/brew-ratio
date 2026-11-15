// 음력 -> 양력(그레고리력)/율리우스력 변환 래퍼.
// 한계: korean-lunar-calendar 는 현대 천문·역법 기준 표다. 16세기 조선이 쓰던 역법과
// 월 경계가 하루 어긋날 수 있으므로 결과는 '계산값'이며 사료 날짜를 덮어쓰지 않는다.
import KoreanLunarCalendar from "korean-lunar-calendar";

export const CONVERTER = "korean-lunar-calendar@0.4.0";
const pad = (n) => String(n).padStart(2, "0");
const dayMs = 86400000;

/** 일 단위 그레고리력(ISO) -> 율리우스력. 1582-10-15 ~ 1700-02-28 구간은 -10일. */
export function gregorianToJulian(g) {
  const d = new Date(`${g}T00:00:00Z`);
  if (d < new Date("1582-10-15T00:00:00Z") || d >= new Date("1700-03-01T00:00:00Z")) throw new Error("지원 범위 밖");
  return new Date(d.getTime() - 10 * dayMs).toISOString().slice(0, 10);
}

const GAN = "甲乙丙丁戊己庚辛壬癸";
const JI = "子丑寅卯辰巳午未申酉戌亥";

/** 그레고리력(proleptic) 날짜의 율리우스 일수. */
export function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/** 일간지(日干支). 일 단위 육십갑자는 달력 개혁과 무관하게 연속이라 날짜를 직접 식별한다. */
export function ganji(y, m, d) {
  const i = (jdn(y, m, d) + 49) % 60; // 2000-01-01 = 戊午 기준
  return GAN[i % 10] + JI[i % 12];
}

export const ganjiOfIso = (iso) => ganji(...iso.split("-").map(Number));

/** 육십갑자로 존재 가능한 조합인가 (천간·지지의 홀짝이 같아야 함). */
export function isValidGanji(s) {
  if (typeof s !== "string" || s.length !== 2) return false;
  const g = GAN.indexOf(s[0]), j = JI.indexOf(s[1]);
  return g >= 0 && j >= 0 && g % 2 === j % 2;
}

/** 기록된 일간지와 기대 일간지의 차이. stem_match: 천간 일치 여부, branch_shift: 지지 차이(-5..6). */
export function compareGanji(written, expected) {
  const stemMatch = written[0] === expected[0];
  const shift = (((JI.indexOf(written[1]) - JI.indexOf(expected[1]) + 5) % 12) + 12) % 12 - 5;
  return { written, expected, stem_match: stemMatch, branch_shift: shift };
}

/** ISO 날짜에 일 단위 offset 을 더한다. */
export function addDays(iso, n) {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * dayMs).toISOString().slice(0, 10);
}

/** 음력 -> { gregorian, julian } 또는 null(표에 없는 날짜/범위 밖). */
export function lunarToGregorian(year, month, day, leap = false) {
  const cal = new KoreanLunarCalendar();
  let ok = false;
  try { ok = cal.setLunarDate(year, month, day, !!leap); } catch { ok = false; }
  if (!ok) return null;
  const s = cal.getSolarCalendar();
  const gregorian = `${s.year}-${pad(s.month)}-${pad(s.day)}`;
  let julian = null;
  try { julian = gregorianToJulian(gregorian); } catch { /* 지원 범위 밖 */ }
  return { gregorian, julian };
}

/** 양력 -> 음력 { year, month, day, leap } 또는 null. */
export function gregorianToLunar(gregorian) {
  const [y, m, d] = gregorian.split("-").map(Number);
  const cal = new KoreanLunarCalendar();
  let ok = false;
  try { ok = cal.setSolarDate(y, m, d); } catch { ok = false; }
  if (!ok) return null;
  const l = cal.getLunarCalendar();
  return { year: l.year, month: l.month, day: l.day, leap: !!l.intercalation };
}
