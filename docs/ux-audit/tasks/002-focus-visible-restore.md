# 002 · [P1 a11y] 키보드 포커스 링 복원

**우선순위**: 높음. **난이도**: 소. **의존**: 없음.

## 문제
`src/renderer/src/index.css:22-30`이 모든 button/[role=button]/a의 focus 아웃라인을 제거하고 대체 스타일이 없어, 키보드 사용자가 포커스 위치를 전혀 볼 수 없다. (마우스 클릭 시 주황 아웃라인이 보기 싫어 끈 것으로 보이나, 키보드 접근성까지 죽였다.)

## 대상 파일 · 정확한 변경
`src/renderer/src/index.css` — 현재 블록:
```css
button:focus, button:focus-visible,
[role='button']:focus, [role='button']:focus-visible,
a:focus, a:focus-visible { outline: none; }
```
을 아래로 교체(마우스 포커스는 링 없음, 키보드 포커스만 accent 링):
```css
/* 마우스 클릭 포커스는 링 없음, 키보드(:focus-visible)에만 accent 링 */
button:focus:not(:focus-visible),
[role='button']:focus:not(:focus-visible),
a:focus:not(:focus-visible) { outline: none; }

button:focus-visible,
[role='button']:focus-visible,
a:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid rgb(var(--accent) / 0.6);
  outline-offset: 2px;
  border-radius: 4px;
}
```

## 건드리지 말 것
- 이미 `focus:border-accent`로 명확한 포커스를 주는 입력들(그대로 두면 outline과 겹쳐도 무해하나, 과하면 해당 입력만 `focus-visible:outline-none`으로 예외 처리 가능).
- 컴포넌트별 커스텀 포커스(있다면).

## 수용 기준
- Tab 키로 이동 시 버튼/링크/입력에 accent 링이 보인다.
- 마우스 클릭 시엔 링이 나타나지 않는다(기존 인상 유지).
- 특히 ConfirmDialog에서 Tab 시 취소/삭제 버튼 포커스가 시각적으로 구분된다.

## 검증
`npm run dev` 후 키보드 Tab으로 사이드바·모달·툴바 순회하며 링 표시 확인. `npm run typecheck` 통과(CSS만 변경이라 무관하지만 습관적으로).
