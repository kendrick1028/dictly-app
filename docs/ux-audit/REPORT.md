# Dictly UI/UX 적대적 감사 리포트

_방식: 렌즈별 병렬 서브에이전트(어포던스·마이크로카피·기능발굴) + 오케스트레이터 직접 코드 감사(비주얼 시스템·버그·접근성). 각 발견은 파일:라인/grep으로 근거. 픽셀 단위 시각 판정은 코드 추론이면 confidence를 낮추고 "스크린샷 필요"로 표기. 이 실행에서 앱 코드는 수정하지 않음._

## 총평 (TL;DR)
Dictly의 **레이아웃·모션·빈상태 어포던스는 이미 프로 수준**이다(일관된 이징, 탄탄한 대시보드/스튜디오, 다음 행동을 지목하는 좋은 빈상태 카피). "아마추어 티"의 실체는 두 축이다: **(A) 이름/용어의 혼란** — 하나의 "강의" 개념이 화면마다 *메모·노트·전사문·강의* 4~5개 이름으로 불리고 `노트`와 `메모`가 서로 반대 뜻으로 겹쳐, 코드가 스스로 `메모(필기)`라 괄호로 해명한다. **(B) 비주얼 시스템의 미세 불일치** — 대시보드·시간표가 앱 토큰과 *거의 같지만 다른* 색을 인라인으로 쓰고, 타입 스케일이 없어 9~30px 사이 **19종의 제각각 폰트 크기**가 난립하며, 키보드 포커스 링이 전역 제거돼 있다. 기능 버그는 **최근 추가한 '노트 소스'가 스튜디오 생성 게이팅에서 누락돼 노트만 선택하면 생성 진입이 막히는 회귀(P1)** 1건.

가장 심각한 건 **안전성**이다: 폴더 삭제가 하위 강의·PDF·학습자료 전부를 개수 경고·되돌리기 없이 영구 삭제하며(캐스케이드), 앱 전체에 **되돌리기(undo)가 하나도 배선돼 있지 않다**(Toast는 undo를 지원하나 사용처 0). "복잡한 기능을 설명 없이 쉽게"라는 목표 대비, 설명 자체는 절제돼 있으나 **판단에 꼭 필요한 정보는 `?` 툴팁에 숨기고, 사소한 건 상시 노출**하는 역전과, **핵심 AI 기능(실시간 교정·자동 정리)이 ⚙ 팝오버에 매몰**돼 발견성이 낮다.

**권장 처리 순서:** P1-8(폴더 삭제 데이터 손실) → P1-1(노트소스 버그) → P1-2(포커스 링) → P1-9(폴더 이름변경 부재) → P1-3(MemoView 안내) → P1-4(팔레트 토큰화) → P1-7(정보 은닉/발견성) → P1-5(용어, *결정 필요*) → P1-6(타이포). 세부 지시서는 `tasks/`.

---

## P1 — 고임팩트 (버그 / 프로 완성도)

### P1-1. [버그] 노트만 소스로 선택하면 스튜디오 생성이 막힘 (회귀) · 상
- **근거**: `components/studio/StudioHub.tsx:126` `folderHasSel = folderSrcMemoIds.length>0 || folderSrcPdfIds.length>0` — **`folderSrcNoteIds` 누락**. 이번 세션의 '연결 노트 소스' 기능에서 store/manifest/job/StudioChat은 갱신됐으나 StudioHub 게이팅만 미갱신.
- **재현**: 폴더 → 소스에서 '노트'만 체크(전사문·PDF 미체크) → 8개 생성 카드 전부 disabled, 툴팁 "메모·PDF를 체크하세요". 실제 생성 로직은 노트만으로 동작 가능.
- **영향**: 방금 추가한 기능 진입 불가. 더구나 카드가 `disabled`라 안내 `title` 툴팁이 **Chromium에서 아예 표시되지 않아**(disabled 요소의 native title 억제) 사용자는 회색 카드가 왜 안 눌리는지 알 수도 없음. → `tasks/001-studio-notes-source-gating.md`

### P1-2. 키보드 포커스 링이 앱 전역 제거됨 · 상 (a11y)
- **근거**: `src/renderer/src/index.css:22-30`이 button/[role=button]/a의 `outline:none`, 대체 `:focus-visible` 없음.
- **영향**: 키보드 사용자가 포커스 위치를 못 봄. `ConfirmDialog`는 삭제 버튼 포커스+Enter=확정이라, 포커스 불가시 성에서 Enter가 곧 삭제. → `tasks/002-focus-visible-restore.md`

### P1-3. MemoView 빈상태가 존재하지 않는 "새 메모" 버튼을 가리킴 + 문구 중복 · 상
- **근거**: `components/MemoView.tsx:38-39` "왼쪽의 "새 메모" 버튼으로 시작하세요" — 실제 버튼은 "새 노트"뿐(`grep '새 메모'` = 이 한 줄). 위·아래 두 줄이 의미 중복.
- **영향**: 설명이 잘못된 어포던스를 지목 → 없는 버튼을 찾게 함. → `tasks/004-memoview-emptystate-copy.md`

### P1-4. 대시보드·시간표가 앱 토큰과 다른 색 팔레트를 인라인 사용 · 상
- **근거**: `Home.tsx`(하드코딩 hex 33곳)·`Timetable.tsx`(8곳). `INK='#2a2a38'` vs 토큰 `ink='#1f2329'`; `MUTED='#9aa0aa'` vs `subtle='#8a8f98'`; `SOFTBG='#f7f7f9'` vs `canvas='#f7f7f5'`. Home 주석 "design palette (Dictly 홈.dc.html)" — 목업 이식 후 토큰 미재조정.
- **영향**: 첫 화면이 앱 나머지와 미묘히 다른 톤 → "아마추어" 인상 + accent 테마 교체 시 대시보드만 안 따라옴. → `tasks/003-dashboard-palette-tokens.md`

### P1-5. 하나의 "강의"가 4~5개 이름 + `노트`/`메모` 상호 오염 · 상 (**사용자 결정 필요**)
- **근거**: 같은 엔티티(memos)가 `MemoView.tsx:99`·`Sidebar.tsx:328` **메모**, `Sidebar.tsx:545` 트리 헤더 **노트**, `FolderView.tsx:116` **전사문**, `Spotlight.tsx:26`·`ChatView.tsx:314` **강의**로 불림(라벨 카운트 노트36·메모32·전사문23·강의10). 게다가 대형 CTA "새 노트"가 두 곳에서 **다른 객체**를 만든다 — `Sidebar.tsx:445,560` → 강의(createMemo, 기본제목 "N월 N일 녹음") vs `notes/NotesNav.tsx:94` → TipTap 필기(newNote). 역방향으로 `Sidebar.tsx:434`·`NotesNav.tsx:92` title="메모"는 **필기 뷰**를 연다. 코드가 `MemoView.tsx:94`·`SettingsModal.tsx:204`에서 "메모(필기)"로 괄호 해명 = 문제의 자백. 아이콘도 강의에 `FileText`/`Volume2`/`AudioLines` 3종 혼용.
- **영향**: 신규 사용자가 개념 지도를 못 세움("새 노트를 눌렀는데 녹음 화면"). 최상위 IA 혼란.
- **권장**: 사용자 대면 이름을 1:1 고정 — 예) 강의=**"강의"/"녹음"**, 필기=**"노트"**, 스튜디오 저장물=**"학습 자료"**. `전사문`은 강의의 *탭 이름*으로만. 아이콘: 강의=`AudioLines`, PDF=`FileText`, 필기=`StickyNote` 고정. **명명 확정은 UX 라이팅 결정이라 사용자 승인 후 일괄 치환.** → `tasks/005-terminology-unify.md` (사용자 결정 대기)

### P1-6. 타이포 스케일 부재 — 19종 임의 폰트 크기 · 상
- **근거**: `text-[Npx]` distinct = 9,9.5,10,10.5,11,11.5,12,12.5,13,13.5,14,14.5,15,16,17,18,22,23,30 (반계단 다수 = 눈대중).
- **영향**: 위계 흐릿 + 비슷한 요소가 0.5px씩 달라 정돈감 저하. → `tasks/006-type-scale.md`

### P1-7. 판단에 필요한 정보는 툴팁에 숨기고, 핵심 기능은 ⚙에 매몰 · 상/중
- **근거(정보 은닉)**: `ConnectModal.tsx:200,213` 엔진 선택의 핵심 판단근거("빠름·실시간 교정 적합" vs "느림")를 hover `?`(HelpTip)에 은닉. `RecordBar.tsx:82,94` 두 "미리보기" 체크박스 라벨이 거의 동일해 툴팁 없이 구분 불가.
- **근거(발견성)**: 대표 가치인 `실시간 교정`·`종료 후 자동 정리`가 `RecordBar` `Settings2` 팝오버 안에만 존재. `TranscriptArea.tsx:129` 목차 기능은 라벨 없는 `Sparkles` 아이콘+hover 툴팁만.
- **권장**: 판단정보는 카드 부제/인라인 subtext로 상시화; 두 미리보기는 상호배타 라디오+변별력 있는 라벨; 핵심 토글은 상태 칩("자동 정리 ON")으로 승격. → `tasks/007-surface-key-info.md`

### P1-8. [안전성] 폴더 삭제가 하위 전부를 개수 경고·되돌리기 없이 영구 삭제 · 상
- **근거**: `Sidebar.tsx:527` 확인 문구는 `'${f.name}' 폴더를 삭제할까요?` 뿐. 반면 `main/db.ts:451-460` `deleteFolder`는 폴더 내 **모든 강의(→오디오·전사·채팅), 폴더 PDF, studio_items를 트랜잭션 일괄 삭제**. 같은 앱의 PDF 공용삭제는 "폴더의 모든 노트에서 사라집니다"라고 경고하는데(`Sidebar.tsx:104`) 훨씬 큰 폴더 삭제엔 경고가 없고, 폴더 삭제 버튼만 hover-red 강조도 없음(`Sidebar.tsx:528`).
- **영향**: 강의 수십 개 든 과목 폴더를 오클릭 한 번으로 영구 소실, 복구 불가.
- **권장**: 확인 문구에 포함 개수 명시("강의 N개·PDF M개가 함께 삭제됩니다"), 삭제 버튼 위험 강조, 그리고 P1-10의 undo. → `tasks/010-destructive-safety.md`

### P1-9. 폴더 이름 변경 UI가 아예 없음 · 상
- **근거**: `renameFolder`가 store(`useStore.ts:1326`)·`window.api.folders.rename`에 있으나 **호출하는 컴포넌트 없음**. `FolderView.tsx:265-274`는 이름을 비편집 span으로 표시(그 `title/setTitle` state는 초기화만 되는 dead code). 사이드바 폴더 행에도 rename 없음.
- **영향**: 생성 시 오타를 고치려면 폴더를 지우고 다시 만들어야 하고(=P1-8 캐스케이드 삭제), 내용물이 날아감.
- **권장**: FolderView 헤더를 MemoView 제목처럼 인라인 편집으로, 또는 사이드바 더블클릭 rename. → `tasks/011-folder-rename.md`

### P1-10. 파괴적 동작에 되돌리기(undo)가 전무 · 상
- **근거**: Toast가 `onUndoAction`/되돌리기 버튼을 지원(`Toast.tsx:100`, `lib/toastStore.ts:70`)하나 렌더러 전체 `onUndoAction` **사용처 0건**. memo/folder/note/studio/PDF/agent/chat/schedule 삭제가 전부 하드 삭제. Home 일정·할일 삭제는 확인조차 없이 즉시(`Home.tsx:237,316`).
- **영향**: 확인 다이얼로그가 유일한 안전장치. 확인 후엔 복구 경로 0 → "실수에 관대"라는 목표와 정면 배치(캐스케이드와 결합 시 위험 증폭).
- **권장**: 최소 memo/folder/note/studio 삭제에 토스트 기반 undo(수 초) 배선. → `tasks/010-destructive-safety.md`

---

## P2 — 개선

### P2-1. `text-subtle`(#8a8f98) 대비 미달 · 상(대비)/중(영향)
`subtle` on `panel #fff` ≈ **3.5:1** (AA 4.5:1 미달), 11~13px 보조 라벨 전반 사용. → `subtle`을 `#6b7280`(≈4.8:1) 정도로. **스크린샷 확인 권장.**

### P2-2. 해요체 ↔ 합니다체 혼재 (최대 톤 결함) · 상
`SettingsModal.tsx` "저장돼요"(:156) ↔ "적용됩니다"(:181,259); `StudioOptionsModal.tsx:226` "자동 구성합니다" ↔ 여러 곳 해요체. → 학생 대상, **해요체 1종 고정**. → `tasks/008-honorific-tone.md`

### P2-3. 토스트 문법 불일치 · 중
"'X' 첨부됨"·"저장됨"(명사종결) ↔ "PDF를 삭제했어요"·"연결했어요"(서술형). → 한 패턴("~했어요")으로 통일.

### P2-4. 상시 노출 설명문(잡음) · 중
`RawTab.tsx:81`(탭 중복 서술), `PdfSection.tsx:86` "최대 2개까지…", `Home.tsx:363` "/일정·/할일" 힌트(할일 유무와 무관 상시), `StructuredTab.tsx:94` 조작 설명 → 빈상태 한정 또는 1회성으로. (`Home.tsx:515` "별표(☆)로 추가하세요"는 별표가 hover 시에만 보여 지시대상이 평소 안 보임 → 어포던스 보강.)

### P2-5. 점진적 공개 과다 — 고급 옵션 상시 노출 · 중
`AgentManager.tsx`가 8개 필드(수식 변환 규칙·교정 규칙·시스템 프롬프트 등 고급 포함) 전량 노출; `SettingsModal.tsx:236-260` VAD 튜닝 상시 펼침; `RecordBar` 옵션 4토글+다수 비활성. → 기본(이름·키워드)만 노출 + "고급" 접기. → `tasks/009-progressive-disclosure.md`

### P2-6. ConfirmDialog가 파괴 라벨/색 하드코딩 + 진입 애니메이션 없음 · 상/severity P2
`ConfirmDialog.tsx`가 항상 빨강 "삭제", `confirmLabel` 없음(PromptDialog엔 있음), `dictly-modal-in` 미적용. **검증**: 호출 3곳 전부 삭제라 현재 라벨은 우연히 맞음 → **잠재결함**. → `confirmLabel`/`variant` 파라미터화 + 애니메이션.

### P2-7. 비공식 2차 accent(퍼플 #6f7bd0) 혼재 · 중
Home 태그·파인만 폴더명·노트 해시태그(index.css:567). 역할 정의 없는 2번째 accent. → 시맨틱 토큰화하거나 accent 통일. **스크린샷 필요.**

### P2-8. 도달 불가한 죽은 폴더 채팅면(FolderChat) · 중
`store/useStore.ts:806` `setFolderChat`이 UI에서 `null`(닫기)로만 호출, 여는 진입점 없음(폴더 질문은 폴더-스코프 StudioChat이 담당). `FolderChat.tsx:84` 카피도 "노트=강의" 오용. → 제거 또는 연결.

### P2-9. 접근성 · 키보드 (상호작용 렌즈) · 상
- **hover 전용 액션이 탭 순서에서 제외**: 사이드바 삭제/즐겨찾기/PDF첨부/연결해제·북마크·복사·재생성 등이 `hidden group-hover:block`(`display:none` → 키보드 도달 불가) 또는 `opacity-0 group-hover`(보이지 않는 포커스 표적). 예 `Sidebar.tsx:310,514,528`, `TranscriptTab.tsx:585`, `StudioChat.tsx:368`. → 최소 히트영역에 상시 흐릿 노출 또는 우클릭/키보드 경로.
- **Toast에 `aria-live` 없음**(`Toast.tsx`) → "삭제했어요"·"인덱싱 실패"·undo 안내가 스크린리더에 무음. 스트리밍 AI 답변도 live region 없음. → 컨테이너 `aria-live="polite"`(error=assertive).
- **모달 시맨틱/ESC 불일치**: SettingsModal만 Esc 닫기(`:16`); ConnectModal·Timetable·StudioOptionsModal·ScheduleConfirmModal·AgentManager는 Esc 없음. 전 모달 `role="dialog"`/`aria-modal`/포커스 트랩 부재(렌더러 aria-* 5건). → 공통 Modal 래퍼로 표준화.
- **폴더 소스 체크박스** `aria-checked` 없음·on/off 무관 동일 title(`FolderView.tsx:129,161,195`). → role=checkbox+aria-checked.
- **리사이즈 핸들이 완전 비가시**(`ResizeHandle.tsx`, "no visible grip") → 3열 리사이즈 가능함을 알 수 없음. → hover 시 얇은 라인, focus-visible 링.

### P2-10. 상호작용 일관성 · 상/중
- **전사문 세그먼트 편집에서 ESC가 취소가 아니라 저장**(`TranscriptTab.tsx:609` `Escape→commitEdit`). 앱 다른 곳은 Esc=취소(PromptDialog·PdfViewer·검색). 전사 편집엔 undo도 없어 잘못 건드리면 되돌릴 수 없음. → Esc=원복, Cmd+Enter=저장.
- **북마크 발견성 순환**: 북마크 탭은 북마크가 있을 때만 생성(`TranscriptArea.tsx:38`)되는데, 만드는 버튼은 `opacity-0 group-hover` 아이콘(`TranscriptTab.tsx:585`) → 기능 전체가 숨겨짐.
- **TranscriptPreview 무한 스피너**: `memos.get`이 null/실패(삭제된 소스 미리보기)면 에러/빈 분기 없이 영구 스피너(`folder/TranscriptPreview.tsx:98`). → "불러올 수 없음" 폴백.
- **모달 Enter 제출 불일치**: StudioOptionsModal·ScheduleConfirmModal은 Enter 미제출, PromptDialog·Home AddForm은 제출. 
- **녹음 시작 더블클릭 가드 미확인**(`RecordBar.tsx:152` start()의 createMemo→startRecording 비동기 구간), **Quiz 빈 제출 허용/답 비영속**(`QuizView.tsx:112`), PdfViewer 줌 툴박스 hover 전 비가시.

### P2-11. 기타 · 하
- "에이전트" 명칭이 자율 AI로 오인됨(실제=과목 키워드/교정 프로파일). 코드가 매번 "/ 키워드"로 보조설명 → "과목 프로파일" 등으로. (`App.tsx:95`, `ModelSelect.tsx:104`)
- placeholder에 지시문 태우기(`AgentManager.tsx:360`). 에이전트 목록 이모지 "🅰"(lucide와 이질). 모델 표기 불일치(`ModelSelect.tsx` vs `ConnectModal.tsx:265`). 색상 단독 상태 표시 일부 잔존(대개 title 병기).

---

## 잘 된 점 (유지)
- 다음 행동을 지목하는 빈상태 카피(`Home`·`tabs/*`·`StudioHub.tsx:167`).
- 행동 결과를 미리 안심시키는 문구(`ScheduleConfirmModal.tsx:80` "자동 등록 아님", `AgentManager.tsx:227` "검토 후 저장").
- 슬래시 커맨드 팔레트(한/영 별칭+그룹+힌트) = 점진적 공개 모범.
- **VAD 슬라이더의 "권장 범위 초록 밴드"(`SettingsModal.tsx:84-104`)** = 설명 대신 시각 어포던스로 안전값 전달 → 이 패턴을 다른 고급 설정에도 확장 권장.
- 모션 이징 일관성(`cubic-bezier(0.22,1,0.36,1)`), 테마화된 `--accent`, `.clock` 탭ular-nums.

## 스크린샷 감사 권장 (코드로 판정 불가)
간격 리듬/정렬·밀도, 노트 4열 동시 표시 시 좁은 폭 붕괴, 스튜디오 생성물(마인드맵·시험레이더) 렌더 품질, `text-subtle`/퍼플 실제 가독성, 다크모드 부재. → `npm run dev` 후 화면 캡처로 재확인.

## 검증 메모 (자기 반증)
- "ConfirmDialog 삭제 라벨=P1 버그" → 호출 3곳 전부 삭제로 **P2 잠재결함 강등**.
- "HelpTip 남용=설명 과다" → 사용 소수 확인, **실체는 용어중복+상시 힌트+정보 은닉역전**으로 재정의.
- P1-1·1-3·1-4·1-6은 파일:라인/grep으로 코드 확인(상).

## 도구 신뢰성 메모
5개 렌즈 서브에이전트 중 **비주얼·버그 렌즈 2개가 도구호출 0회 빈 결과**(이 하네스 불안정) → 오케스트레이터가 직접 코드 감사로 커버(비주얼 시스템·타이포·팔레트·포커스·노트소스 버그 등). **어포던스·마이크로카피·상호작용/a11y·기능발굴 렌즈 3개는 정상 완료**(총 40+파일 감사)되어 본 리포트·OPPORTUNITIES에 반영. 상호작용 렌즈가 폴더삭제 캐스케이드·undo 부재·rename 부재를 독립 발견해 오케스트레이터가 놓친 데이터손실 경로를 보완(적대적 팬아웃의 효과). ConfirmDialog·HelpTip 결함은 복수 렌즈가 교차 확인.
