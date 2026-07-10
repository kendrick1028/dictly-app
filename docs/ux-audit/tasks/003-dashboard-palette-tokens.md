# 003 · [P1] 대시보드·시간표 인라인 색을 디자인 토큰으로 통일

**우선순위**: 높음. **난이도**: 중(기계적이나 범위 넓음). **의존**: 없음.

## 문제
`components/Home.tsx`(하드코딩 hex 33곳)와 `components/Timetable.tsx`(8곳)이 앱 토큰과 *거의 같지만 다른* 자체 색 상수를 인라인 style로 사용한다:
- `INK = '#2a2a38'` ↔ 토큰 `ink = '#1f2329'`
- `MUTED = '#9aa0aa'` ↔ 토큰 `subtle = '#8a8f98'`
- `SOFTBG = '#f7f7f9'` ↔ 토큰 `canvas = '#f7f7f5'`
- 배경 `#fff` ↔ 토큰 `panel`
결과: 첫 화면이 앱 나머지와 미묘히 다른 톤 + accent 테마 교체 시 대시보드만 안 따라옴.

## 정확한 변경
`Home.tsx`, `Timetable.tsx`에서:
1. `INK`→ `text-ink`(#1f2329), `MUTED`→ `text-subtle`(#8a8f98; 단 task P2-1에서 subtle 자체를 어둡게 조정 예정이면 그 값 따름), `SOFTBG`→ `bg-canvas`, 배경 `#fff`→ `bg-panel`로 치환. 가능하면 인라인 `style={{color:...}}`을 Tailwind 클래스(`text-ink`/`text-subtle`)로 옮긴다.
2. accent로 쓰이던 곳(진행바·선택 색 `ACCENT = 'rgb(var(--accent))'`)은 그대로 두거나 `text-accent`/`bg-accent`로.
3. 토큰에 대응이 없는 **의미색만** 소수의 시맨틱 상수로 남긴다:
   - D-Day 경고색(`#d9482f`/`#d98a1f`), todo 태그 퍼플(`#6f7bd0`/`#eef0fb` — task P2-7과 함께 결정), 시간표 과목 파스텔 6종(`CLASS_COLORS`, 카테고리색이라 유지), 차트 그리드 라인(`#eef0f2` 등).
   - 이들은 지우지 말고, 파일 상단에 "의미색(토큰 외)" 주석으로 명시.

## 건드리지 말 것
- `CLASS_COLORS` 6색 파스텔(시간표 과목 구분용 카테고리 팔레트 — 정당).
- 차트(SVG) 수치·좌표 로직.
- accent CSS 변수 자체.

## 수용 기준
- Home/Timetable의 잉크·보조·배경 색이 앱 토큰과 일치(육안+코드에서 `#2a2a38`/`#9aa0aa`/`#f7f7f9` 사라짐).
- accent 테마를 바꾸면(설정) 대시보드 강조색도 함께 바뀐다.
- `grep -rEo "#[0-9a-fA-F]{6}" src/renderer/src/components/Home.tsx | sort -u` 결과가 "의미색"만 남는다(잉크/보조/배경 계열 제거).

## 검증
`npm run typecheck` 통과. `npm run dev`로 대시보드와 노트/폴더 화면을 나란히 비교(회색·잉크 톤 일치). **스크린샷 권장**.
