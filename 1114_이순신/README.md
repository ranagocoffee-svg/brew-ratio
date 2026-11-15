# Project YI — 이순신 생애·세계사 연표·난중일기 아카이브

기획 근거: `crosscheck-2026-11-15.md` (ChatGPT/Gemini/Claude 3회차 교차검증).
기준 판본: **교감본(노승석)**. 첫 산출물: **1597년 MVP 스키마와 샘플 데이터**.

## 명령
```bash
npm run validate   # 샘플 데이터 검증
npm test           # 단위 테스트 (Node 18+)
npm run serve      # MVP 화면: http://127.0.0.1:5173/ (연표·사료 층위·판본/일기)
```

## 일기 원문 입력 흐름
1. `data/input/gyogam-1597.tsv`에 하루 한 줄로 입력한다 (열: `lunar_month, lunar_day, leap, gregorian, text_han, text_ko, source_ref, note`). 헤더와 주석만 있는 빈 템플릿이 들어 있다.
2. 미리 확인: `node tools/import_diary.mjs data/input/gyogam-1597.tsv data/sample/1597 --year 1597 --by <입력자> --dry`
3. 오류가 하나도 없을 때만 저장된다. 같은 id는 교체, 나머지는 유지. 월별 입력 일수가 출력된다.
4. `npm run validate`로 최종 확인.

**국가유산포털 원문 가져오기(초고본 5책)**: `node tools/research/fetch_heritage_text.mjs 5` → `node tools/research/build_diary_tsv.mjs 5 4 data/input/heritage-1597.tsv 1` → `node tools/import_diary.mjs data/input/heritage-1597.tsv data/sample/1597 --year 1597 --by <이름> --edition ed-autograph --reading rd-heritage-portal`. 포털은 펼침면(2쪽) 단위로 응답하므로 중복 면을 제거하고, 날짜 번호를 기준으로 일별 분할한다. 포털 판독문은 미검수이며 이용 조건(공공누리 유형)을 확인하기 전에는 공개 배포하지 않는다.

**일간지 불일치(`ganji_check`)**: 일기에 적힌 간지가 변환값 ±3일의 어떤 날과도 맞지 않으면 거부하지 않고 `certainty: disputed`와 `ganji_check`(적힌 값, 기대값, 천간 일치, 지지 이동)로 기록한다. 이때 양력은 천간이 맞는 날(변환값 ±1일)을 우선한다. 1597년 5책은 7/4~10/3에서 천간은 맞고 지지가 일관되게 +2라 이 경로를 탄다.

**일간지(`day_ganji`)**: 일기 날짜 머리의 일간지를 적으면 양력이 확정된다(`certainty: verified`). 입력 양력과 어긋나거나 변환값 ±3일 안에 없으면 거부되고, 검증기도 저장된 양력과 일간지가 다르면 오류로 잡는다. 일간지는 달력 개혁·역법 차이와 무관해 변환기보다 우선한다. 명량 9/16이면 甲辰=10/26, 癸卯=10/25.

규칙: `text_han`(한문 판독문)이 분석 대상이고 `source_ref`(교감본 쪽수 등)는 필수. 입력 직후 상태는 `transcribed`/`unverified`이며, `reviewed`는 `reviewed_by`가 있어야 한다. 입력된 날이 없는 날은 "사건 없음"이 아니라 "입력되지 않음"이다.

**저작권 주의**: 한문 원문은 공유 재산이지만 교감본의 교감 결과와 한글 번역은 노승석 등의 저작물일 수 있다. 사용 허락을 확인하기 전에는 `text_ko`를 비우고, 한문은 입력자가 직접 판독·대조한 것만 넣는다. `text_ko`를 채우면 `--translator`가 필요하다.

## 구조
- `data/schema/schema.json` — 데이터 모델 (Source, Event, Claim, Edition, Reading, DiaryEntry, Coverage, DateRecord)
- `data/sample/1597/*.json` — 1597년 샘플 데이터
- `tools/validate.mjs` — 스키마·참조 무결성·날짜 일관성 검증

## 설계 원칙
1. **날짜**: 원본 달력 표기(음력·윤달 여부)를 보존하고 그레고리/율리우스 값은 따로 저장한다. 율리우스력은 그레고리력 -10일(검증기가 확인).
   - **음력→양력**은 `korean-lunar-calendar@0.4.0`(`tools/lunar.mjs`)으로 계산하되 **사료 날짜를 덮어쓰지 않는다.** 입력값과 계산값이 다르면 `certainty: disputed`로 두고 `computed_gregorian`에 계산값을 병기한다(검증기가 강제). 이 표는 현대 기준이라 16세기 조선 역법과 월 경계가 하루 어긋날 수 있다. 실제로 명량(음력 1597-9-16)은 문서의 양력 10-26과 변환기의 10-25가 다르다. 조사 결과 변환기 표 오류 가능성이 높으나 확정은 아니다(아래 다음 단계 2번).
   - 기준점 4건(1545-3-8, 1592-4-13, 1592-7-8, 1598-11-19)은 문서 값과 일치해 테스트에 고정했다.
2. **검증 상태**: 모든 연표 항목은 `verified: false`, `certainty: unverified`로 시작한다. 원문 대조 후에만 올린다.
3. **출처별로 갈리는 수치**는 `claims.json`에 병기한다 (예: 명량의 일본 함선 수).
4. **결측**은 `coverage.json`으로 "기록 안 됨/결락"과 "사건 없음"을 구분한다.
5. **판본·판독 분리**: DiaryEntry는 `edition_id`와 `reading_id`를 함께 가진다. 분석은 한문(`text_han`), 번역(`text_ko`)은 표시용.
6. **본문 미생성**: 난중일기 본문은 교감본 원문을 입력하기 전까지 `placeholder`로 둔다.

## 샘플에서 의도적으로 비워 둔 것
- 칠천량 해전·투옥의 정확한 날짜, 명량의 음력 날짜(9/16은 확인 전), 교감본 출간 연도·판독 연도
- 1597년 일기 본문과 일별 존재 여부 (`cv-gyogam-1597`: to_verify)
- 일본 16세기 사료(와키자카기·고려선전기)의 서지

## 다음 단계
1. 교감본에서 1597년 일기 원문을 입력하고 일별 coverage 집계
2. 명량 하루 차이(10-25 vs 10-26): 조사 결과는 `docs/investigations/myeongnyang-date.md`. 변환기 표 오류 가능성이 높고, 교감본 9/16 일기의 일간지(甲辰=10/26, 癸卯=10/25)로 확정할 수 있다.
3. 변환기의 월 초하루를 천문 삭과 대조하는 경고 검사를 검증기에 추가 (`tools/research/check_month_starts.mjs` 참고)
3. 데이터 출처(한국고전종합DB, 조선왕조실록 DB) 라이선스 확인
4. Cross-Time Slider / Divergence Viewer UI (React + Vite)
