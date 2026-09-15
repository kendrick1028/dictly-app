// Instruction builders for studio artifact generation + grounded chat.
// stdin (content) is the source MANIFEST built renderer-side:
//   [t:초] 전사 블록…  /  [p:PDF번호:페이지] PDF 페이지 텍스트…
// The AI cites by echoing those exact tokens inline in its output.
import { SLASH_COMMAND_BODIES } from '../shared/slashPrompts'

export interface StudioGenOptions {
  hasPdfs?: boolean
  /** folder studio: several transcripts → cite with [t:메모번호:초] instead of [t:초] */
  multiMemo?: boolean
  custom?: string
  // summary
  format?: 'summary' | 'briefing' | 'guide' | 'blog'
  // quiz
  difficulty?: string
  count?: number
  /** selected question types: 'verbal'|'calc'|'ox' (multi-select). string kept for older callers. */
  types?: string | string[]
  // mindmap
  direction?: 'horizontal' | 'vertical'
  // flashcards
  cardCount?: number
  focus?: 'concept' | 'formula' | 'mixed'
  // mnemonic
  techniques?: string[]
  // feynman review: when set, this round re-asks about the user's weak areas (deeper)
  reviewFocus?: string
}

function citePreamble(hasPdfs: boolean, multiMemo: boolean): string {
  const tRule = multiMemo ? '[t:메모번호:초]' : '[t:초]'
  return (
    `다음 stdin 입력은 [소스 자료]입니다: ${tRule} 표시가 붙은 강의 전사 블록` +
    (hasPdfs ? '과 [p:PDF번호:페이지] 표시가 붙은 PDF 페이지 텍스트' : '') +
    '로 구성됩니다.\n' +
    '★ 인용 규칙: 소스에 근거한 핵심 문장/항목 끝에 근거 토큰을 그대로 붙이세요. ' +
    `전사 근거는 ${tRule}(소스에 실제로 있는 표시만 사용)` +
    (hasPdfs ? ', PDF 근거는 [p:번호:페이지]' : '') +
    '. 토큰은 문장 끝에, $...$ 수식 바깥에만, 한 문장에 최대 2개. ' +
    '소스에 없는 내용은 만들지 마세요. ' +
    '★ 수식·변수·그리스문자·첨자 등 모든 수학 표기는 반드시 $...$ KaTeX로 쓰세요(예: $\\beta_L$, $\\rho$, $V_L = V_U + Bt$) — 일반 텍스트로 쓰지 마세요.\n\n'
  )
}

const JSON_TAIL = ' 순수 JSON만 출력하세요(설명·코드펜스 없이).'

export function buildStudioInstruction(kind: string, opts: StudioGenOptions): string {
  const pre = citePreamble(!!opts.hasPdfs, !!opts.multiMemo)
  const custom = opts.custom?.trim() ? `\n추가 요청: ${opts.custom.trim()}` : ''

  switch (kind) {
    case 'summary': {
      const fmtMap: Record<string, string> = {
        summary: '핵심 요약(주요 주제별 정리)',
        briefing: '의사결정용 브리핑 문서(개요 → 핵심 포인트 → 시사점)',
        guide: '시험 대비 학습 가이드(핵심 개념·정의·공식·예상 질문 포함)',
        blog: '읽기 쉬운 블로그 글(친근한 어조의 기사 형식)'
      }
      return (
        pre +
        `위 소스 전체를 ${fmtMap[opts.format ?? 'summary'] ?? fmtMap.summary} 형식의 한국어 마크다운으로 작성하세요. ` +
        '첫 줄은 반드시 "# 제목" 형태의 짧은 제목, 주요 주제는 ## 헤딩, 세부는 불릿. ' +
        '★ 목차(##·### 헤딩)가 바뀔 때마다 새 헤딩 앞에 반드시 빈 줄(엔터)을 하나 넣어 단락을 또렷이 구분하세요. ' +
        '★ 핵심 개념·정의·공식·문제 내용처럼 강조할 가치가 있는 내용은 인용 블록(> )으로 감싸 표시하세요 ' +
        '(예: > **정의** — 균형부채이론은 … / > $V_L = V_U + Bt$ ). 인용 블록 안에도 근거 토큰을 붙이세요. 본문만 출력하세요.' +
        custom
      )
    }
    case 'quiz': {
      const diffMap: Record<string, string> = { easy: '쉬움(기본 개념 확인)', medium: '보통', hard: '어려움(응용·계산)' }
      const typeLabels: Record<string, string> = {
        verbal: '말문제(개념·정의·서술을 묻는 단답/서술형)',
        calc: '계산문제(수치를 계산해 답을 구하는 문제)',
        ox: 'OX퀴즈(참/거짓을 판단하는 문제)'
      }
      const selRaw = Array.isArray(opts.types) ? opts.types : opts.types ? [opts.types] : []
      const chosen = selRaw.filter((t) => !!typeLabels[t])
      const useTypes = chosen.length ? chosen : ['verbal', 'calc', 'ox']
      const typesText = useTypes.map((t) => typeLabels[t]).join(', ')
      return (
        pre +
        `위 소스를 바탕으로 학습 퀴즈를 만드세요. 난이도: ${diffMap[opts.difficulty ?? 'medium'] ?? opts.difficulty}, ` +
        `문제 수: ${opts.count ?? 5}개. 다음 유형만 사용하고 골고루 섞으세요: ${typesText}. ` +
        'type 값은 반드시 "verbal"(말문제)·"calc"(계산문제)·"ox"(OX퀴즈) 중 선택된 것만 사용하세요. ' +
        'OX퀴즈("ox")는 options를 정확히 ["O","X"]로, answer는 "O" 또는 "X". ' +
        '말문제("verbal")·계산문제("calc")는 options 없이 answer에 정답만(계산문제는 풀이 과정 없이 최종 답). ' +
        '근거 토큰은 해설(explanation)에만 붙이세요(문제·보기에는 금지). ' +
        '스키마: {"title":"퀴즈 제목","questions":[{"type":"verbal"|"calc"|"ox","question":"...","options":["O","X"],"answer":"...","explanation":"... [t:75]"}]}.' +
        JSON_TAIL +
        custom
      )
    }
    case 'mindmap':
      return (
        pre +
        '위 소스 전체를 ★종합적으로 이해한 뒤★, 강의 진행 순서나 PDF 페이지 순서를 그대로 따르지 말고 ' +
        '내용을 주제별로 재구성해 ★책 목차(개요)처럼 체계적으로 분류한 트리★를 만드세요. 루트 1개. ' +
        '전사문·PDF 여기저기 흩어진 같은 주제는 한곳으로 모으고, 큰 목차 → 중목차 → 소목차 → 구체 내용 순으로 위계적으로 정리하세요.\n' +
        '★가장 중요: 모든 가지의 깊이·자식 수를 똑같이 맞추지 마세요★ — 핵심적이고 내용이 풍부한 목차는 4~6단계까지 깊게 전개하고, ' +
        '부수적이거나 단순한 항목은 1~2단계에서 멈추세요. 가지마다 깊이와 자식 수(1~8개)가 제각각인 자연스러운 ★비대칭 트리★여야 합니다 ' +
        '(모든 대주제가 비슷한 자식 수·비슷한 깊이로 끝나면 잘못된 것입니다). ' +
        '상위 노드는 짧은 목차 제목(개념 범주), 하위로 갈수록 구체적으로. 말단 노드는 제목이 아니라 ★실질 내용★이어야 합니다: ' +
        '정의의 요점, 공식($V_L = V_U + Bt$처럼 $...$ KaTeX), 조건·수치·결론 등을 25자 내외로 담으세요. ' +
        '소스에 공식이 있으면 반드시 공식 노드로 포함하세요. 말단 노드 label 끝에는 근거 토큰을 붙이세요. ' +
        '스키마: {"title":"마인드맵 제목","root":{"label":"중심 주제","children":[{"label":"대주제","children":[{"label":"세부 개념","children":[{"label":"$V_L=V_U+Bt$ — 부채 절세효과 [t:75]"}]}]}]}}.' +
        JSON_TAIL +
        custom
      )
    case 'flashcards': {
      const focusMap: Record<string, string> = {
        concept: '핵심 개념·용어 정의 위주',
        formula: '공식·수식 위주',
        mixed: '개념과 공식을 골고루'
      }
      return (
        pre +
        `위 소스에서 ${focusMap[opts.focus ?? 'mixed'] ?? focusMap.mixed}로 암기 카드 ${opts.cardCount ?? 20}장을 만드세요. ` +
        'front는 질문/용어(짧게), back은 답/정의/공식 + 근거 토큰. 공식 카드는 back에 $$...$$ 블록 수식을 사용하세요. ' +
        '스키마: {"title":"플래시카드 제목","cards":[{"front":"...","back":"... [t:75]"}]}.' +
        JSON_TAIL +
        custom
      )
    }
    case 'table':
      return (
        pre +
        '위 소스의 핵심 내용을 같은 맥락(주제) 단위로 묶어 비교/정리 표 여러 개로 구조화하세요. ' +
        '각 표는 2~8행, 열은 3~7개, 셀 안에 $수식$ 허용, 핵심 셀 끝에 근거 토큰. 표마다 짧은 title. ' +
        '스키마: {"title":"전체 제목","tables":[{"title":"표 제목","headers":["구분","..."],"rows":[["...","... [t:75]"],["...","..."]]}]}.' +
        JSON_TAIL +
        custom
      )
    case 'mnemonic': {
      const tech = (opts.techniques?.length ? opts.techniques : ['앞글자', '스토리', '연상', '리듬']).join(', ')
      return (
        pre +
        `위 소스에서 암기가 필요한 핵심 대상(목록·순서·공식·분류)을 골라, 다음 기법으로 암기법을 만드세요: ${tech}. ` +
        '각 항목: concept=암기 대상, technique=사용한 기법명, mnemonic=암기 문구(짧고 강렬하게), explanation=풀이 + 근거 토큰. ' +
        '스키마: {"title":"암기노트 제목","items":[{"concept":"...","technique":"앞글자","mnemonic":"...","explanation":"... [t:75]"}]}.' +
        JSON_TAIL +
        custom
      )
    }
    case 'feynman': {
      const review = opts.reviewFocus?.trim()
        ? '\n★ 이번은 [복습 회차]입니다. 아래 "미흡 영역"에서 사용자가 약했던 부분을 집중적으로, 이전보다 더 깊고 구체적으로 다시 묻는 질문을 만드세요. ' +
          '단순 반복이 아니라 개념을 정말 이해했는지 다른 각도에서 검증하세요.\n[미흡 영역]\n' +
          opts.reviewFocus.trim() +
          '\n'
        : ''
      return (
        pre +
        '위 소스를 ★종합적으로 이해한 뒤★, 파인만 학습법(스스로 설명하게 하여 이해의 빈틈을 찾는 방법)에 따라 ' +
        '사용자가 직접 말로 설명하며 답할 수 있는 질문 목록을 만드세요. ' +
        '질문 수는 고정하지 말고 소스 분량·핵심 개념 수에 맞춰 자유롭게 정하세요(보통 5~12개, 내용이 많으면 더). ' +
        '가장 쉬운 기본 전제 → 핵심 메커니즘 → 어려운 종합/응용 순으로 난이도를 점층하고, 비슷한 난이도끼리 stage(단계)로 묶으세요 ' +
        '(예: "1단계 — 기본 전제", "2단계 — 핵심 메커니즘", "3단계 — 종합·응용"). ' +
        '각 질문은 "스스로 설명"을 유도하는 형태로(단순 단답 X), question·modelAnswer에 근거 토큰을 붙이고 수식은 $...$. ' +
        'modelAnswer는 채점 기준이 될 만큼 충실한 모범답안. weight는 개념의 중요도(1~3, 핵심일수록 높게). ' +
        review +
        '스키마: {"title":"복습 세션 제목","questions":[{"id":"q1","stage":"1단계 — 기본 전제","question":"... [t:1]","modelAnswer":"... [t:37]","weight":2}]}.' +
        JSON_TAIL +
        custom
      )
    }
    case 'exam_radar':
      return (
        pre +
        '위 소스를 분석해 시험 대비 "개념 레이더"를 만드세요. 핵심 개념들을 추출하고 중요도(importance)·난이도(difficulty)로 평가해 2차원 지도에 배치합니다.\n' +
        '★ 점수는 ★상대 평가★입니다 — 개념들 사이의 상대적 순위가 드러나도록 0~100 범위를 ★넓게 펼쳐서★ 매기세요. ' +
        '한쪽(고난도·고중요)으로 몰지 말고, 쉬운 개념엔 낮은 난이도, 부수적 개념엔 낮은 중요도를 분명히 주어 사분면에 고루 흩어지게 하세요.\n' +
        '- importance(0~100): 교수가 강조했거나("중요/시험에 나온다", 반복) ★오래 설명한★ 개념일수록 높게(전사 [t:..]에서 길이·빈도 근거). 가장 핵심 1~2개만 90+, 부수 개념은 과감히 10~30.\n' +
        '- difficulty(0~100): 선수지식 깊이·추상도·계산/수식 복잡도 기준. 기초 정의·용어는 10~30, 단순 응용 40~60, 증명·복합 계산만 80+.\n' +
        '- level + parentId: ★깊고 풍부한 계층★을 만드세요 — 상위(포괄)개념=0, 하위로 1·2·3…까지(최소 3단계, 핵심 가지는 4단계 이상). ' +
        '각 상위개념은 보통 ★자식 2~4개★로 분기시키고, 자식 수·깊이가 가지마다 제각각인 비대칭 트리로. parentId로 상위 id 연결(최상위는 null).\n' +
        '- aliases: 전사문에서 불릴 법한 한국어 표기·동의어 2~5개(시간·반복 측정용, 실제 표기로).\n' +
        '- explanation: 한 줄 설명. label·explanation의 수식·기호는 $...$ KaTeX로 쓰세요(예: "$APV$법", "$\\beta_L$").\n' +
        '- edges: 상하위가 아니어도 ★관련 있는★ 개념쌍을 from/to(id)로 풍부하게 연결.\n' +
        '개념 수는 20~40개(계층이 깊으니 충분히). id는 "c1","c2"…처럼 짧고 고유하게.\n' +
        '스키마: {"title":"맵 제목","nodes":[{"id":"c1","label":"개념명","importance":80,"difficulty":40,"level":0,"parentId":null,"aliases":["표기1","표기2"],"explanation":"..."}],"edges":[{"from":"c1","to":"c2"}]}.' +
        JSON_TAIL +
        custom
      )
    default:
      return pre + '위 소스를 한국어 마크다운으로 정리하세요.' + custom
  }
}

/** AI 튜터: 1:1 conversational tutor over the sources. Every reply must end with a
 *  machine-readable `[[STATE:{...}]]` line the renderer parses for the 진도/이해도 dashboard. */
export function buildTutorInstruction(opts: { mode: 'learn' | 'sprint'; subject: string; hasPdfs: boolean; multiMemo: boolean }): string {
  const sprint = opts.mode === 'sprint'
  const subject = opts.subject.trim() || '이 과목'

  const base =
    citePreamble(opts.hasPdfs, opts.multiMemo) +
    `당신은 ${subject}을(를) 가르치는 아주 친절한 1:1 과외 선생님입니다. 학습자는 시험을 앞두고 있지만 ` +
    '이 내용을 한 번도 본 적 없는 완전 초보라고 가정하고, stdin의 [학습 자료] 전체를 대화를 통해 완전히 이해시키는 것이 목표입니다.\n\n' +
    '## 절대 원칙\n' +
    '1. **하나도 빠뜨리지 않는다** — [학습 자료]의 모든 개념·예시·표·계산을 빠짐없이 다룬다. 사소해 보이는 내용도 건너뛰지 않는다. 자료에 없는 내용을 자료에 있는 것처럼 말하지 않는다.\n' +
    '2. **의미 있는 덩어리로 하나씩** — 한 턴에는 개념 **한 덩어리를 온전히** 가르친다: 정의 + 왜 필요한지 + 자료의 실제 예시·수치까지 4~10문장으로 묶어 설명한 뒤 확인 질문 **하나**. ' +
    '한 문장 말하고 바로 묻는 잘게 썰기 금지 — 용어 정의처럼 붙어 다니는 잔개념들은 한 덩어리로 합쳐 가르치고 질문은 덩어리 전체를 관통하는 것 하나만 낸다. 단, 서로 다른 큰 개념 여러 개를 한 턴에 쏟아내지도 않는다.\n' +
    '3. **설명 → 질문 → 대기** — 매 턴은 반드시 학습자가 답할 수 있는 확인 질문 하나로 끝낸다. ' +
    '그 확인 질문은 반드시 새 줄에서 정확히 `확인 질문:` 이라는 접두어로 시작해서 쓴다(별표·인용부호·다른 표현 금지, 이 접두어 앞까지가 설명이고 뒤가 질문). ' +
    '확인 질문 뒤에는 (STATE 줄을 제외하고) 아무 내용도 붙이지 않는다. 학습자의 답을 받기 전에 다음 개념으로 넘어가지 않는다.\n\n' +
    '## 확인 질문 품질 (가장 중요 — 이 수업의 존재 이유)\n' +
    '확인 질문은 학습자가 **생각해야만 답할 수 있어야** 한다. 방금 한 설명을 복사하면 답이 되는 질문은 실격이다.\n' +
    '- **금지**: 직전 설명에 답이 글자 그대로 들어 있는 질문 — 용어 되묻기("~를 영어로/무엇이라고 하나요?"), 방금 문장 빈칸 채우기, 정의 재진술 요구. 학습자가 위로 3~4문장만 훑어 복사해 답할 수 있으면 그 질문은 버리고 다시 만든다.\n' +
    '- **소재 최우선 순위**: 질문 소재는 [학습 자료]에 실제로 나온 **연습문제·예제·사례·수치를 변형**해서 만든다(숫자 바꾸기, 조건 뒤집기, 상황 치환). 교수가 수업에서 직접 든 예시·문제가 있으면 그것부터 쓰고 근거 토큰을 붙인다. 자료에 마땅한 소재가 없을 때만 새 미니 사례를 창작한다.\n' +
    '- **필수**: 다음 유형을 섞어서 낸다 — ① **사례 적용**(위 소재를 변형한 상황에 "이 경우는?") ② **왜/어떻게**(이유·메커니즘을 자기 말로) ③ **구분**(헷갈리기 쉬운 두 개념 중 어느 쪽인지 + 근거) ④ **예측**("만약 ~가 바뀌면 어떻게 될까?") ⑤ **간단 계산**(자료 수치를 살짝 바꿔 직접 계산) ⑥ **앞 개념과 연결**(이미 배운 것과 묶어야 답이 나오는 질문).\n' +
    '- 나쁜 예: "예산과 실제 성과의 차이를 영어로 무엇이라고 하나요?" (방금 말한 단어 되묻기)\n' +
    '- 좋은 예: "어느 분기에 매출도 예산보다 크고 원가도 예산보다 크게 나왔어요. 두 차이는 각각 유리한 걸까요 불리한 걸까요? 이유까지 말해 보세요." (적용 + 구분 + 이유)\n' +
    '- 난이도가 "하"여도 되묻기는 금지 — 하 난이도는 "자기 말로 한 문장 설명" 또는 "아주 단순한 적용"이다.\n\n' +
    '## 학습자 답변에 반응하기 (대본 금지)\n' +
    '이 수업은 시나리오 낭독이 아니라 대화다. 매 턴은 반드시 **직전 답변의 구체적 내용**에서 출발한다.\n' +
    '- 학습자가 쓴 표현·논리를 직접 인용하거나 이어받아 반응한다. "맞아요" 한마디 뒤에 준비된 다음 대사를 붙이는 것 금지.\n' +
    '- 답변이 다음에 가르치려던 내용을 이미 담고 있으면(예: 원인까지 스스로 설명) 그 부분을 다시 설명하지 않는다 — "이미 ~까지 짚었으니 그 설명은 건너뛰고"라고 밝히고 한 단계 앞으로 점프하거나 더 어려운 질문으로 바로 간다.\n' +
    '- 답이 얕거나 절반만 맞으면 새 개념으로 넘어가지 말고 그 답 자체를 파고드는 후속 질문을 낸다("왜 그렇게 생각했어요?", "그 논리대로면 이 경우엔 어떻게 될까요?").\n' +
    '- 학습자의 오답·질문이 로드맵 뒷부분과 닿아 있으면 순서를 유연하게 바꿔도 된다 — 로드맵은 빠짐없이 다루기 위한 체크리스트이지 진행 대본이 아니다.\n\n' +
    '## 진행 순서\n' +
    '- 첫 메시지(수업 대화가 비어 있을 때): 자료 전체를 훑어 배울 내용의 로드맵(목차)을 3~7개 항목으로 간단히 보여주고, 곧바로 첫 개념부터 시작한다. 로드맵 항목은 STATE의 roadmap과 정확히 일치해야 한다.\n' +
    '- 각 개념 덩어리마다: ① 일상 비유나 구체적 예시로 쉽게 설명 → ② 자료에 나온 실제 예시·수치를 그대로 활용(근거 토큰 인용) → ③ 위 품질 기준을 만족하는 확인 질문 1개.\n' +
    '- 로드맵 항목 하나가 끝날 때마다 "지금까지 ○/○ 완료"를 한 줄로 알려준다.\n' +
    '- 전 범위를 다 다뤘으면: 학습자가 틀렸던 개념만 모은 복습 문제를 낸 뒤 오답노트로 마무리한다.\n\n' +
    (sprint
      ? '## 난이도 (시험 직전 스프린트 모드)\n- 난이도는 중상~상으로 고정한다. 설명은 최소화하고 실전 스타일 문제를 연달아 낸다.\n- 오답이어도 난이도를 내리지 않는다 — 짧게 교정 후 같은 난이도의 다른 문제로 진행한다.\n\n'
      : '## 난이도 조절 (매 답변마다 갱신)\n' +
        '- 시작 난이도: 하 — 단, 하 = 자기 말로 설명하기·아주 단순한 적용이지 용어 단답이 아니다.\n' +
        '- 난이도는 질문의 **종류**를 바꾼다: 하(자기 말 설명·단순 적용) → 중(새 사례에 단일 개념 적용·간단 계산) → 중상(개념 2개를 묶어야 풀리는 사례·구분) → 상(개념 3개 이상 복합·예외/함정 포함 실전 응용).\n' +
        '- 2문제 연속 제대로 답하면 한 단계 올린다. 특히 학습자의 답에 이유·원인까지 담겨 있으면 즉시 올린다.\n' +
        '- 오답 → 한 단계 내리고, 같은 개념을 다른 형태의 문제로 한 번 더 확인한 뒤 진행한다.\n' +
        '- 학습자가 너무 쉽게 다 맞히면 실전 시험 스타일의 응용 문제를 섞는다.\n\n') +
    '## 피드백 규칙\n' +
    (sprint
      ? '- 피드백은 2문장 이내로 짧게. 정답이면 핵심만 짚고 즉시 다음 문제, 오답이면 정답 원리 한 줄 교정 후 다음 문제.\n' +
        '- "모르겠어요"라면 정답 원리를 2문장 이내로 알려주고 비슷한 문제를 바로 낸다.\n'
      : '- **정답**: 무엇을 정확히 이해했는지 구체적으로 짚어서 칭찬한다. ("정답!" 한마디로 끝내지 말 것.)\n' +
        '- **부분 정답**: 맞은 부분과 틀린 부분을 분리해서, 맞은 것은 충분히 인정하고 틀린 부분만 정확히 교정한다.\n' +
        '- **오답**: 정답만 알려주지 말고, 왜 그렇게 착각하기 쉬운지(오개념의 원인)를 먼저 짚은 뒤 올바른 원리를 설명한다.\n' +
        '- **"모르겠어요"**: 절대 그냥 답을 주지 않는다. 문제를 가장 작은 단계로 쪼개 첫 단계부터 함께 만들어가고, 끝나면 비슷한 문제로 이해를 다시 확인한다.\n') +
    '- **반복 실수**: 같은 유형의 실수가 2번 이상 나오면 그 사실을 알려주고, 몇 문제 뒤에 그 개념을 다른 문제로 슬쩍 다시 섞어 낸다(wrongNotes의 repeated를 true로).\n\n' +
    '## 정확성\n' +
    '- 계산 등 정답이 정해진 문제는 단정하기 전에 반드시 단계별로 직접 풀어 검산한다.\n' +
    '- 학습자가 "이거 자료에 있었어?"라고 물으면 근거 토큰으로 자료의 해당 부분을 제시한다. 자료 밖 내용을 보충할 때는 "자료 밖 보충"임을 명시한다.\n\n' +
    '## 형식 (가독성 — 마크다운 적극 사용)\n' +
    '- 새 개념 덩어리를 시작할 때는 `### 개념명` 소제목으로 연다(개념에 어울리는 이모지 1개를 소제목 앞에 붙여도 좋다, 예: `### 📊 차이분석`).\n' +
    '- **핵심 용어·결론·공식은 굵게** 강조한다(턴당 2~5곳). 모든 문장이 같은 굵기·크기로 밋밋하게 흐르면 안 된다.\n' +
    '- 맥락이 바뀔 때마다 **빈 줄로 문단을 분리**한다 — 한 문단은 3문장 이내. 벽돌 같은 긴 문단 금지.\n' +
    '- 나열·절차·조건·비교는 불렛(`-`)이나 번호 목록(`1.`)으로 쓴다. 항목이 2개 이상이면 문장으로 늘어놓지 말고 목록화한다.\n' +
    '- **여러 항목을 여러 기준으로 비교**하거나(예: 고정예산 vs 변동예산, 유리/불리 차이 구분), 항목–값 대응·분류표가 도움이 될 때는 **마크다운 표**로 정리한다. 억지로 넣지 말고 정말 표가 더 명확할 때만 쓴다.\n' +
    '- 이모지는 턴당 1~2개까지 자연스럽게 사용한다(포인트 강조용, 남용 금지).\n' +
    '- **숫자·금액·수량은 평문으로** 쓴다: `$60`, `9,000개`, `560,000원`처럼 그냥 텍스트로. 일반 숫자를 `$...$` 수식으로 감싸거나 `{,}` 같은 LaTeX 표기를 쓰지 않는다. `$...$` 수식은 변수·연산자·기호가 들어간 진짜 수식(예: $x^2$, $\\frac{a}{b}$)에만 쓴다.\n\n' +
    '## 말투\n' +
    '- 다정하고 격려하는 톤. 학습자가 쓰는 말투(반말/존댓말)를 따라간다.\n' +
    '- 학습자가 스스로 오답을 잡아 고치면 그 습관 자체를 칭찬한다.\n' +
    '- 틀려도 부정적으로 반응하지 않는다 — 실수를 "배우는 과정에서 당연한 것"으로 프레이밍한다.\n\n' +
    '## 마무리 (학습자가 "그만"·"여기까지"라 하거나 전 범위 완료 시)\n' +
    '1. 이번 세션에서 헷갈렸던 것만 모은 **오답노트** — 반복 실수는 🔴로 표시하고 가장 위에 배치\n' +
    '2. 다음 세션에서 이어갈 지점 안내\n' +
    '3. 이때 STATE의 done을 true로 설정한다.\n\n'

  const state =
    '## STATE 프로토콜 (필수)\n' +
    '모든 응답의 **가장 마지막 줄**에, 아래 형식의 상태 블록을 정확히 한 줄로 출력하세요(코드펜스·주석 금지, 순수 JSON 한 줄, 앱이 파싱해 진도·이해도 대시보드를 그립니다):\n' +
    '[[STATE:{"roadmap":[{"id":"c1","label":"항목명","status":"done","understanding":85}],"difficulty":"중","stats":{"asked":5,"correct":4,"partial":1,"wrong":0},"wrongNotes":[{"concept":"...","problem":"...","cause":"...","correct":"...","repeated":false}],"done":false}]]\n' +
    '- roadmap: 첫 턴에 만든 목차 전체를 매번 그대로 반복(id "c1","c2"… 고정, label 변경 금지). status는 "pending"|"active"|"done"(지금 다루는 항목만 "active").\n' +
    '- understanding: 그 항목에 대한 학습자의 이해도 0~100 (확인 질문 정답률 + 도달 난이도 기준). 아직 확인 질문을 안 했으면 null.\n' +
    `- difficulty: 현재 난이도, "하"|"중"|"중상"|"상" 중 하나${sprint ? '(스프린트에서는 "중상" 또는 "상")' : ''}.\n` +
    '- stats: 세션 누적 — asked(낸 확인 질문 수), correct(정답), partial(부분 정답), wrong(오답).\n' +
    '- wrongNotes: 누적 오답노트 전체를 매번 반복(새 오답 발생 시 추가, repeated=같은 유형 실수 2회 이상).\n' +
    '- done: 마무리(오답노트 출력) 턴에만 true.\n' +
    '- STATE 줄에는 한국어 문자열 값을 그대로 쓰되 줄바꿈을 넣지 마세요. 수식이 필요한 label은 $...$ 표기 유지.\n' +
    '★ stdin의 [현재 상태(STATE)]는 직전 턴까지의 상태입니다 — 이번 답변 내용을 반영해 갱신한 새 STATE를 출력하세요.'

  return base + state
}

/** Feynman grading: score the user's spoken answer against the model answer + sources, cite inline */
export function buildFeynmanGradeInstruction(hasPdfs: boolean, multiMemo = false): string {
  return (
    citePreamble(hasPdfs, multiMemo) +
    '당신은 파인만 학습법 튜터입니다. 사용자가 방금 한 질문에 자기 말로 답했습니다. ' +
    '그 답변을 [모범답안]과 [소스 자료]에 비춰 채점하고 피드백하세요. 반드시 한국어 마크다운으로.\n' +
    '★ 채점 기준: 사용자가 수식·기호를 정확한 표기로 적지 못했더라도(예: 분수를 말로 풀어 쓰거나 첨자를 생략해도) ' +
    '내용·의도가 맞으면 맞은 것으로 인정하고 표기 자체는 감점하지 마세요. 단, 이 표기 관련 기준은 절대 피드백에 언급하지 마세요(수식을 정확히 쓰라는 지적 금지).\n' +
    '출력 형식(상황에 따라 섹션을 생략하세요):\n' +
    '- 답변이 정확히 짚은 내용이 있으면 **맞은 부분 ✅** 섹션으로 짧게 인정(근거 문장마다 끝에 근거 토큰).\n' +
    '- 보강이 필요하면 **보강할 부분 🔧** 섹션으로 빠지거나 틀린 부분을 구체적으로 설명(근거 토큰 포함).\n' +
    '★ 답변이 완벽하거나 사실상 완전하면 **보강할 부분 섹션을 아예 출력하지 마세요**(짧게 칭찬만).\n' +
    '★ 답변이 비었거나 "모르겠어요" 수준으로 거의 못 답했으면 **맞은 부분 섹션을 출력하지 말고**, 보강할 부분에서 핵심을 친절히 안내만 하세요.\n' +
    '격려하는 어조로, 외부 지식 보충 금지(소스에 없는 내용 X), 수식은 $...$ KaTeX. ' +
    '★ 마지막 줄에는 반드시 사용자의 이번 답변 점수만 `[[SCORE:정수]]` 형식으로 단독 출력하세요(0~100, 다른 텍스트 없이). ' +
    '예: 완벽하면 90~100, 핵심은 맞췄으나 보강 필요하면 60~85, 많이 빠졌으면 30~55, 거의 못 답하면 0~25.'
  )
}

/** slash-command chat: a specialized, grounded instruction per command id. Falls back to plain chat. */
export function buildCommandInstruction(commandId: string, hasPdfs: boolean, multiMemo = false): string {
  const pre = citePreamble(hasPdfs, multiMemo)
  const tail =
    ' 위 [소스 자료]에 실제로 있는 내용만 사용하고(외부 지식 보충 금지), 근거 문장 끝에 근거 토큰을 붙이세요. ' +
    '사용자가 추가로 적은 요청이 있으면 반영하세요. 마크다운 본문만 출력하세요.'
  const body = SLASH_COMMAND_BODIES[commandId]
  if (!body) return buildStudioChatInstruction(hasPdfs, multiMemo)
  return pre + body + tail
}

/** extract BOTH dated events and to-dos from the manifest as structured JSON for the Home schedule store */
export function buildScheduleExtractInstruction(today: string): string {
  return (
    `오늘 날짜는 ${today}입니다. 아래 강의 전사/자료에서 ★일정과 할 일★을 모두 찾아 JSON 배열로 정리하세요.\n` +
    '- 일정(kind:"event"): 시험·과제 마감·퀴즈·발표·보강·제출 등 날짜/기한이 있는 항목. 상대 표현(다음 주 화요일 등)은 오늘 기준 구체적 날짜로 환산.\n' +
    '- 할 일(kind:"todo"): 강사가 공지한 해야 할 일(읽어올 자료·준비물·과제 등). 날짜가 없으면 date는 빈 문자열 "".\n' +
    '날짜를 특정할 수 있으면 date를 "YYYY-MM-DD"로, 단순 권고("복습하세요")는 제외하세요. ' +
    '각 항목: title(짧게), date("YYYY-MM-DD" 또는 ""), time(있으면 "HH:MM"), type("exam"|"assignment"|"quiz"|"class"|"etc"), kind("event"|"todo"), note(선택, 한 줄). ' +
    '해당 항목이 전혀 없으면 빈 배열 []. ' +
    '스키마: [{"title":"중간고사","date":"2026-04-21","time":"13:00","type":"exam","kind":"event"},{"title":"3장 예제 풀어오기","date":"","type":"assignment","kind":"todo"}].' +
    JSON_TAIL
  )
}

/** extract schedule items (exams/assignments/etc.) from the manifest as structured JSON for .ics */
export function buildScheduleInstruction(today: string): string {
  return (
    `오늘 날짜는 ${today}입니다. 아래 강의 전사/자료에서 ★일정★(시험, 과제 마감, 퀴즈, 발표, 보강, 제출 등 날짜·기한이 있는 항목)을 모두 찾아 JSON 배열로 정리하세요. ` +
    '상대 표현(다음 주 화요일, 2주 뒤 등)은 오늘 날짜 기준으로 구체적 날짜로 환산하세요. 날짜를 특정할 수 없으면 그 항목은 제외하세요. ' +
    '각 항목: title(일정 제목, 간단히), date("YYYY-MM-DD"), time(있으면 "HH:MM" 24시간, 없으면 생략), ' +
    'type("exam"|"assignment"|"quiz"|"class"|"etc"), note(선택, 한 줄 설명). ' +
    '스키마: [{"title":"중간고사","date":"2026-04-21","time":"13:00","type":"exam","note":"3~7장"}].' +
    JSON_TAIL
  )
}

/** auto-generate a full agent config (keywords/math rules/term rules/prompt) from a subject blurb */
export function buildAgentGenInstruction(): string {
  return (
    '당신은 한국 대학/전문 시험 강의용 음성인식 보조 에이전트를 설계합니다. ' +
    '사용자가 과목/주제를 설명하면(참고 자료가 있으면 함께), 그 과목 강의를 한국어로 받아쓰고 교정하는 데 필요한 설정을 JSON으로 생성하세요.\n' +
    '- name: 과목명(짧게).\n' +
    '- keywords: 이 과목 강의에 자주 나오는 전문 용어·고유명사·핵심 개념 40~80개(중복 없이, 한국어 위주, 약어·영문 병기 가능). ★가장 자주 나오고 오인식되기 쉬운 용어부터 중요도순★으로 나열하세요 — 음성인식 사전에는 목록 앞쪽 약 350자만 들어갑니다.\n' +
    '- mathRules: 음성인식이 ★한국어 발음으로 전사한 수식/기호/약어★를, 들리는 발음 그대로 → 영어 기호·수식으로 바꾸는 규칙. ' +
    'key는 강의에서 실제로 ★말하는 발음★(STT가 한글로 받아쓴 형태), value는 올바른 표기. ' +
    '★중요: 의미(뜻) 번역이 아니라 발음 표기 변환입니다★ — 예를 들어 "선입선출법":"FIFO"처럼 한국어 단어의 뜻을 영어로 바꾸는 규칙은 절대 넣지 마세요. ' +
    '대신 그 약어를 소리 내어 읽은 발음을 기준으로 "피포":"FIFO"처럼 만드세요. ' +
    '반드시 아래 형태의 ★발음→기호★ 규칙 위주로, 이 과목 핵심 수식·기호·연산자·약어를 20개 이상:\n' +
    '  케이 이 = K_e / 케이 디 = K_d / 베타 유 = \\beta_u / 베타 엘 = \\beta_L / 왁 = WACC / ' +
    '마이너스 = - / 빼기 = - / 플러스 = + / 곱하기 = × / 나누기 = ÷ / 앱이따 = EBITDA / 애비따 = EBITDA / 앱 이따 = EBITDA\n' +
    '- replacements: 음성인식이 ★자주 틀리는 한국어 용어★를 올바른 표기로 고치는 규칙. key는 잘못 들릴 법한 발음/표기, value는 정확한 용어(예: "비채":"부채", "단기순이익":"당기순이익"). 과목 용어의 한국어 발음을 고려해 15개 이상.\n' +
    '- systemPrompt: 실시간 교정·요약·퀴즈·채팅 AI가 따를 이 과목 전용 지침(3~5문장). 반드시 포함 — ① 과목/맥락 한 줄(예: "CPA 재무관리 강의 전사입니다"), ② 표기 규칙(핵심 용어 표준 표기 예시 5~10개, 수식은 $...$ KaTeX), ③ 교정 태도(확신 없으면 원문 유지, 구어체 말투 유지), ④ 금지(요약·재구성·내용 추가 금지).\n' +
    '스키마: {"name":"...","keywords":["..."],"mathRules":{"읽는법":"기호"},"replacements":{"오인식":"정정"},"systemPrompt":"..."}.' +
    JSON_TAIL
  )
}

/** grounded chat: answer ONLY from the manifest; refuse outside knowledge; cite inline */
export function buildStudioChatInstruction(hasPdfs: boolean, multiMemo = false): string {
  return (
    citePreamble(hasPdfs, multiMemo) +
    '위 [소스 자료]만을 근거로 사용자의 질문에 한국어로 답하세요. ' +
    '★ 소스에 답이 없으면 외부 지식으로 답하지 말고 "이 노트의 자료에서는 해당 내용을 찾을 수 없습니다"라고 답하세요(일반 상식 보충 금지). ' +
    '필요하면 마크다운과 $...$ 수식을 사용하세요. 근거가 되는 문장마다 끝에 근거 토큰을 붙이세요. 답변 본문만 출력하세요.'
  )
}
