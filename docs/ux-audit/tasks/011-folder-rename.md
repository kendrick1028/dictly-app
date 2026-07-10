# 011 · [P1] 폴더 이름 변경 UI 추가

**우선순위**: 높음(010과 함께 — rename이 없어 오타 수정이 삭제로 이어짐). **난이도**: 소~중. **의존**: 없음(백엔드 이미 존재).

## 문제
`renameFolder`가 store(`useStore.ts:1326`)와 `window.api.folders.rename`에 이미 있으나 **호출하는 컴포넌트가 없다.** `FolderView.tsx:265-274`는 폴더명을 비편집 `<span>`으로 표시하고, 그 `title/setTitle` state는 초기화만 되는 dead code다. 사이드바 폴더 행에도 rename이 없다. 결과: 오타를 고치려면 폴더를 삭제(=010 캐스케이드)해야 한다.

## 정확한 변경 (택1 또는 둘 다)
- **FolderView 헤더 인라인 편집**(권장): `FolderView.tsx`의 폴더명 `<span>`을 MemoView 제목(`MemoView.tsx:61-68`)과 동일한 패턴의 인라인 `<input>`으로. 이미 있는 `title/setTitle` state를 살려 `onBlur`/`Enter`에서 `renameFolder(folderId, title.trim())` 호출(빈값·미변경이면 무시). 실제 `useStore`의 rename 액션 시그니처를 확인해 맞춘다.
- **사이드바 더블클릭 rename**(선택): 폴더 행 더블클릭 시 인라인 입력.

## 건드리지 말 것
- `renameFolder` store 액션/IPC(이미 동작). 폴더 트리 구조/드래그.

## 수용 기준
- 폴더명 오타를 삭제 없이 수정할 수 있다(헤더에서 편집 → 저장 → 사이드바·대시보드에 반영).
- 빈 이름 저장은 무시(기존 이름 유지).

## 검증
`npm run typecheck` 통과. `npm run dev`에서 폴더 열고 헤더에서 이름 변경 → 사이드바 반영 확인. `FolderView.tsx`에 dead `title/setTitle`가 남지 않도록 정리.
