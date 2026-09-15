---
name: ios-tabbar-seam
description: iOS 26/27 SwiftUI에서 하단 탭바와 콘텐츠 사이에 구분선/밴드가 보이거나, 콘텐츠가 탭바 뒤로 이어지지 않거나, 상단이 잘릴 때. 스크롤 엣지 이펙트·배경·safeAreaInset 문제를 순서대로 진단한다.
---

# 하단 탭바 seam(구분선) 문제

플로팅 탭바(iOS 26+ Liquid Glass) 위에 **가로 밴드/구분선**이 보이거나, 리스트 배경이 탭바 뒤에서 끊겨 보이는 증상을 고치는 절차.

## 0. 먼저 확인: 기기 OS 버전 (가장 많이 틀리는 지점)

**시뮬레이터에서 멀쩡한데 기기에서 보이면, 십중팔구 OS 버전 차이다.**

```bash
xcrun devicectl list devices    # 기기 osVersionNumber
xcrun simctl list devices available   # 시뮬 런타임
```

기기가 iOS 27 베타인데 26.x 시뮬로 검증하면 **틀린 결론을 확신하게 된다**. 26.3에서 통하던 `ignoresSafeArea` 우회가 27에서는 상단 인셋까지 삼켰던 사례가 실제로 있었다(UOS 식단, 2026-08 — 수정 5회를 헛돌고 나서야 원인을 찾음).

→ **기기와 같은 런타임의 시뮬레이터를 띄워 재현한 뒤에 고친다.** 재현되지 않으면 아직 원인을 모르는 것이다.

## 1. 밴드/구분선 → 스크롤 엣지 이펙트를 끈다

가장 흔한 원인. iOS 26이 스크롤 콘텐츠 가장자리에 그리는 페이드 밴드가, 플로팅 탭바 위에서는 구분선처럼 보인다.

```swift
List { ... }
    .scrollEdgeEffectHidden(true, for: .bottom)
```

주의할 점:
- **화면마다 따로 걸어야 한다.** 한 화면에서 껐다고 형제 화면이 따라오지 않는다. 페이지 스와이프(TabView) 안의 페이지들은 특히 빠뜨리기 쉽다 — Dictly 스튜디오는 3페이지 중 2개만 꺼둬서 나머지 1개에서 증상이 재발했다(2026-08-20).
- 하단을 가리는 플로팅 패널/탭바가 있는 화면에만 끈다. 아무것도 안 겹치는 화면에서는 엣지 이펙트가 정상적으로 예쁘다.
- 새 스크롤 화면을 추가할 때마다 이 판단을 반복한다. 리뷰 체크리스트에 넣을 것.

## 1.5 리스트 카드가 탭바 위에서 "평평하게 잘려" 있으면 → 범인은 TabView(.page)

엣지 이펙트를 꺼도 구분이 남고, 그룹 리스트의 카드 배경이 둥근 모서리 없이 **수평으로 뚝 잘려** 있다면 스크롤 클리핑이다. `TabView(.page)`(페이지 스와이프)는 페이지를 safe area 앞에서 클리핑해서 안쪽 List가 탭바 뒤로 이어지지 못한다.

- `ignoresSafeArea`를 페이저에 걸어 우회하려 하면 **selection 동기화가 깨진다** (피커는 2페이지를 가리키는데 화면은 0페이지) — 시도하지 말 것.
- 해법: **paged TabView를 가로 ScrollView 페이징으로 교체**한다. 스크롤 뷰는 탭바 뒤까지 자연스럽게 내려가고, 안쪽 List도 자동 인셋을 그대로 받는다. UOS 식단(2026-08)과 Dictly 스튜디오(2026-08-20) 모두 최종적으로 이 교체로 해결됐다.

```swift
@State private var pagePos: Int? = 0   // page(로직 기준)와 양방향 동기화

ScrollView(.horizontal) {
    LazyHStack(spacing: 0) {
        pageA.containerRelativeFrame(.horizontal).id(0)
        pageB.containerRelativeFrame(.horizontal).id(1)
    }
    .scrollTargetLayout()
}
.scrollTargetBehavior(.paging)
.scrollPosition(id: $pagePos)
.scrollIndicators(.hidden)
.onChange(of: page) { _, p in
    guard pagePos != p else { return }
    withAnimation(.smooth(duration: 0.3)) { pagePos = p }
}
.onChange(of: pagePos) { _, p in
    if let p, p != page { page = p }
}
// 상단 고정 헤더(세그먼트 등)는 VStack 이 아니라 safeAreaInset 으로 얹는다 —
// VStack 으로 감싸면 컨테이너가 safe area 를 존중해 또 잘린다
.safeAreaInset(edge: .top, spacing: 0) { header.background(배경색) }
```

## 2. 배경색이 어긋나 보이면 → 컨테이너에서 한 번만 칠한다

`List`(그룹 배경 있음)와 `ScrollView`(배경 없음)가 한 화면에 섞이면 탭바 뒤 색이 서로 다르게 보인다.

```swift
TabView { listPage; scrollPage }
    .background(Color(.systemGroupedBackground).ignoresSafeArea())   // 컨테이너에서 한 번
// 각 List 는
    .scrollContentBackground(.hidden)
```

## 3. 하단 플로팅 패널이 있으면 → safeAreaInset 금지

패널 높이가 바뀔 때 `safeAreaInset`은 **리스트를 즉시 리플로우**시키는데 유리는 아직 줄어드는 중이라, 접히는 순간 흰 사각형이 번쩍인다.

```swift
// 하지 말 것
.safeAreaInset(edge: .bottom) { panel }

// 이렇게
.contentMargins(.bottom, 220, for: .scrollContent)   // 펼친 높이 기준 고정값
.overlay(alignment: .bottom) { panel }
```

인셋은 **고정**이어야 한다. 패널 확장/축소에 따라 인셋을 바꾸면 같은 플래시가 돌아온다.

## 4. `ignoresSafeArea`는 광역으로 쓰지 않는다

상단이 잘리는 증상 대부분의 원인. 배경 뷰에만 한정해서 쓰고, 콘텐츠 계층에는 걸지 않는다. iOS 27은 26보다 이 영향 범위가 넓다.

## 진단 순서 요약

1. 기기 OS 확인 → 같은 런타임 시뮬에서 재현
2. 밴드다 → `.scrollEdgeEffectHidden(true, for: .bottom)`, **모든 스크롤 화면 순회**
3. 색 끊김이다 → 컨테이너 `.background(…ignoresSafeArea())` + `.scrollContentBackground(.hidden)`
4. 패널 접힘 플래시다 → `overlay` + 고정 `contentMargins`
5. 상단 잘림이다 → `ignoresSafeArea` 범위 축소
6. 고친 뒤 **기기에 설치해서** 확인 (시뮬 통과는 근거가 못 된다)

## 사례

- **UOS 식단 (2026-08)**: 기기 iOS 27 / 시뮬 26.3 불일치. `ignoresSafeArea` 우회가 27에서 상단 인셋까지 삼킴. 27 시뮬로 재현한 뒤 paged TabView를 스크롤 페이징으로 교체해 해결.
- **Dictly 스튜디오 항목 페이지 (2026-08-20)**: 겹친 원인 둘 — ① 3페이지 중 항목 페이지만 엣지 이펙트를 남겨둠(밴드) ② `TabView(.page)`가 리스트를 safe area 앞에서 클리핑(카드가 평평하게 잘림). 엣지 이펙트만 꺼서는 안 됐고, 페이저를 가로 ScrollView 페이징으로 교체하고서야 해결. `ignoresSafeArea` 우회 시도는 selection 동기화를 깨뜨렸다.
