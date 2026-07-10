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
