# 001 · [P1 버그] 노트만 선택 시 스튜디오 생성 게이팅 수정

**우선순위**: 최우선(회귀). **난이도**: 소. **의존**: 없음.

## 문제
폴더 화면에서 소스로 '노트'만 체크하면 스튜디오 생성 카드 8개가 전부 비활성이고, 안내 툴팁도 (disabled라) 안 뜬다. 실제 생성 로직(`startStudioJob`, `buildFolderManifest`)은 노트만으로도 동작하도록 이미 갱신돼 있는데 UI 게이팅만 노트를 누락했다.

## 대상 파일 · 정확한 변경
`src/renderer/src/components/studio/StudioHub.tsx`

1. 상단 셀렉터에 노트 선택을 추가:
   - 현재: `const folderSrcPdfIds = useStore((s) => s.folderSrcPdfIds)` 다음 줄에
   - 추가: `const folderSrcNoteIds = useStore((s) => s.folderSrcNoteIds)`
2. `folderHasSel` 계산(현재 약 126행)을 노트 포함으로:
   - 현재: `const folderHasSel = folderSrcMemoIds.length > 0 || folderSrcPdfIds.length > 0`
   - 변경: `const folderHasSel = folderSrcMemoIds.length > 0 || folderSrcPdfIds.length > 0 || folderSrcNoteIds.length > 0`
3. `disabledTip`의 폴더 문구(현재 "왼쪽 소스에서 메모·PDF를 체크하세요")를 `왼쪽 소스에서 전사문·PDF·노트를 체크하세요`로. (※ 용어는 task 005 확정 시 함께 조정될 수 있음 — 지금은 최소로 '노트'만 추가.)

## 함께 볼 것(참고, 변경 아님)
`components/studio/StudioChat.tsx`의 `noSel`은 이미 `srcNoteIds` 포함(정상). 이 task는 StudioHub만 그에 맞춘다.

## 건드리지 말 것
- `startStudioJob`/`resolveStudioTarget`(lib/studioJobs.ts), `buildFolderManifest`(lib/studioManifest.ts) — 이미 노트 처리됨.
- 메모 스코프(`studioScope==='memo'`) 게이팅 로직.

## 수용 기준
- 폴더에서 '노트'만 체크 → 8개 스튜디오 카드가 활성화되고 클릭 시 옵션/생성이 열린다.
- 아무것도 안 체크하면 여전히 비활성 + 문구에 '노트' 포함.

## 검증
`npm run typecheck` 통과. `npm run dev` 후 폴더 화면에서 노트만 체크해 카드 활성 확인.
