import SwiftUI

/// Lightweight markdown renderer for AI output: headings, bullets, quotes, tables,
/// code fences, inline bold/code, `$math$` (shown as tinted code), and Dictly's
/// `[t:초]` cite tokens rendered as tappable ▶ time chips (dictly://seek/<sec>).
struct MarkdownText: View {
    let markdown: String

    private enum Block: Identifiable {
        case heading(Int, String)
        case bullet(Int, String)
        case ordered(String, String)
        case quote(String)
        case code(String)
        case table([String], [[String]])
        case paragraph(String)
        case divider

        var id: UUID { UUID() }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(parseBlocks()) { block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block {
        case .heading(let level, let text):
            inline(text)
                .font(level == 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline)
                .padding(.top, level <= 2 ? 6 : 2)
        case .bullet(let depth, let text):
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Circle().fill(.secondary).frame(width: 5, height: 5).padding(.top, 7)
                inline(text)
            }
            .padding(.leading, CGFloat(depth) * 16)
        case .ordered(let num, let text):
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(num).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                inline(text)
            }
        case .quote(let text):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(Color.accentColor).frame(width: 3)
                inline(text).padding(.vertical, 6)
            }
            .padding(.horizontal, 10)
            .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.footnote.monospaced())
                    .padding(10)
            }
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        case .table(let headers, let rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                    GridRow {
                        ForEach(Array(headers.enumerated()), id: \.offset) { _, h in
                            inline(h).font(.subheadline.bold())
                        }
                    }
                    Divider()
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                inline(cell).font(.subheadline)
                            }
                        }
                    }
                }
                .padding(10)
            }
            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
        case .paragraph(let text):
            inline(text)
        case .divider:
            Divider()
        }
    }

    private func inline(_ raw: String) -> some View {
        ChipText(raw)
    }

    // MARK: block parsing

    private func parseBlocks() -> [Block] {
        var blocks: [Block] = []
        let lines = markdown.components(separatedBy: .newlines)
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty { i += 1; continue }

            if trimmed.hasPrefix("```") {
                var body: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    body.append(lines[i]); i += 1
                }
                i += 1
                blocks.append(.code(body.joined(separator: "\n")))
                continue
            }

            if trimmed == "---" || trimmed == "***" {
                blocks.append(.divider); i += 1; continue
            }

            if trimmed.hasPrefix("#") {
                let level = trimmed.prefix(while: { $0 == "#" }).count
                let text = trimmed.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                blocks.append(.heading(min(level, 3), text)); i += 1; continue
            }

            if trimmed.hasPrefix(">") {
                var quoteLines: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard t.hasPrefix(">") else { break }
                    quoteLines.append(t.dropFirst().trimmingCharacters(in: .whitespaces))
                    i += 1
                }
                blocks.append(.quote(quoteLines.joined(separator: "\n")))
                continue
            }

            if trimmed.hasPrefix("|"), trimmed.hasSuffix("|") {
                var tableLines: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard t.hasPrefix("|") else { break }
                    tableLines.append(t); i += 1
                }
                if tableLines.count >= 2 {
                    let headers = Self.splitTableRow(tableLines[0])
                    let dataStart = tableLines.count > 1 && tableLines[1].contains("---") ? 2 : 1
                    let rows = tableLines.dropFirst(dataStart).map(Self.splitTableRow)
                    blocks.append(.table(headers, Array(rows)))
                } else {
                    blocks.append(.paragraph(tableLines.joined(separator: " ")))
                }
                continue
            }

            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                let depth = (line.prefix(while: { $0 == " " }).count) / 2
                blocks.append(.bullet(min(depth, 3), String(trimmed.dropFirst(2))))
                i += 1; continue
            }

            if let match = trimmed.range(of: #"^\d+\.\s"#, options: .regularExpression) {
                let num = String(trimmed[..<match.upperBound]).trimmingCharacters(in: .whitespaces)
                blocks.append(.ordered(num, String(trimmed[match.upperBound...])))
                i += 1; continue
            }

            blocks.append(.paragraph(trimmed))
            i += 1
        }
        return blocks
    }

    private static func splitTableRow(_ row: String) -> [String] {
        var r = row
        if r.hasPrefix("|") { r.removeFirst() }
        if r.hasSuffix("|") { r.removeLast() }
        return r.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    // MARK: inline parsing

    /// inline renderer used app-wide: real `$math$` typesetting (MathTypeset),
    /// `[t:초]` cite tokens → tappable time links, and markdown bold/italic/code.
    /// corrSpans: 적극 교정 구간(Character 오프셋) — spanColor 로 칠한다 (파란 표시)
    static func inlineAttributed(_ raw: String, corrSpans: [CorrSpan]? = nil,
                                 spanColor: Color = .blue) -> AttributedString {
        // Character 오프셋 스팬 → UTF-16 구간 (수식 regex 가 NSRange 로 돌기 때문)
        var spanRanges: [(start: Int, end: Int)] = []
        if let corrSpans, !corrSpans.isEmpty {
            var charToUTF16: [Int] = [0]
            var utf16 = 0
            for ch in raw {
                utf16 += String(ch).utf16.count
                charToUTF16.append(utf16)
            }
            let charCount = charToUTF16.count - 1
            for span in corrSpans {
                let s = max(0, min(span.start, charCount))
                let e = max(s, min(span.start + span.len, charCount))
                if e > s { spanRanges.append((charToUTF16[s], charToUTF16[e])) }
            }
        }

        guard let regex = try? NSRegularExpression(pattern: #"\$\$([^$]+)\$\$|\$([^$\n]+)\$"#) else {
            return textAttributed(raw)
        }
        let ns = raw as NSString
        let mathMatches = regex.matches(in: raw, range: NSRange(location: 0, length: ns.length))

        // 스팬 경계를 수식 영역 밖으로 스냅 — 수식에 걸치면 수식 전체를 칠한다 (수식 교정이 헤드라인 케이스)
        if !spanRanges.isEmpty, !mathMatches.isEmpty {
            spanRanges = spanRanges.map { span in
                var (s, e) = span
                for m in mathMatches {
                    let ms = m.range.location, me = ms + m.range.length
                    if s > ms, s < me { s = ms }
                    if e > ms, e < me { e = me }
                }
                return (s, e)
            }
            spanRanges.sort { $0.start < $1.start }
            var merged: [(start: Int, end: Int)] = []
            for r in spanRanges {
                if let lastR = merged.last, r.start <= lastR.end {
                    merged[merged.count - 1].end = max(lastR.end, r.end)
                } else {
                    merged.append(r)
                }
            }
            spanRanges = merged
        }

        func intersects(_ lo: Int, _ hi: Int) -> Bool {
            spanRanges.contains { $0.start < hi && $0.end > lo }
        }

        /// 텍스트 조각을 스팬 경계로 잘라 in-span 부분만 색을 덮어쓴다
        func appendText(_ range: NSRange, to out: inout AttributedString) {
            guard range.length > 0 else { return }
            let lo = range.location, hi = range.location + range.length
            var cuts: [Int] = [lo, hi]
            for r in spanRanges {
                if r.start > lo, r.start < hi { cuts.append(r.start) }
                if r.end > lo, r.end < hi { cuts.append(r.end) }
            }
            cuts = Array(Set(cuts)).sorted()
            for i in 0..<(cuts.count - 1) {
                let subLo = cuts[i], subHi = cuts[i + 1]
                var piece = textAttributed(ns.substring(with: NSRange(location: subLo, length: subHi - subLo)))
                if spanRanges.contains(where: { $0.start <= subLo && $0.end >= subHi }) {
                    piece.foregroundColor = spanColor   // 스타일 루프 뒤 덮어쓰기 — 파랑이 이긴다
                }
                out += piece
            }
        }

        var out = AttributedString()
        var last = 0
        for m in mathMatches {
            appendText(NSRange(location: last, length: m.range.location - last), to: &out)
            let mathRange = m.range(at: 1).location != NSNotFound ? m.range(at: 1) : m.range(at: 2)
            var math = MathTypeset.typeset(ns.substring(with: mathRange))
            if intersects(m.range.location, m.range.location + m.range.length) {
                math.foregroundColor = spanColor
            }
            out += math
            last = m.range.location + m.range.length
        }
        appendText(NSRange(location: last, length: ns.length - last), to: &out)
        return out
    }

    /// non-math text: <mark>→bold, cite tokens→links, then Foundation markdown parsing
    private static func textAttributed(_ raw: String) -> AttributedString {
        guard !raw.isEmpty else { return AttributedString() }
        var s = raw
        s = s.replacingOccurrences(of: "<mark>", with: "**").replacingOccurrences(of: "</mark>", with: "**")

        if let regex = try? NSRegularExpression(pattern: #"\[t:(?:\d+:)?(\d+(?:\.\d+)?)\]"#) {
            let ns = s as NSString
            var out = ""
            var last = 0
            for m in regex.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
                out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
                let sec = Double(ns.substring(with: m.range(at: 1))) ?? 0
                // 태그처럼 보이도록 좌우에 얇은 공백을 넣는다 (배경색이 그만큼 넓게 칠해진다)
                out += " [\u{2009}\(timeLabel(sec))\u{2009}](dictly://seek/\(Int(sec)))"
                last = m.range.location + m.range.length
            }
            out += ns.substring(from: last)
            s = out
        }

        var attr = (try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(s)

        for run in attr.runs {
            if run.inlinePresentationIntent?.contains(.code) == true {
                attr[run.range].font = .system(.callout, design: .monospaced)
                attr[run.range].foregroundColor = .indigo
            }
            if run.link != nil {
                // 출처 청크 = 밑줄 링크가 아니라 칩(태그) 모양.
                // 배경은 여기서 칠하지 않는다 — AttributedString 의 backgroundColor 는 사각형만
                // 가능해서, 둥근 캡슐은 SeekChipRenderer 가 런 뒤에 직접 그린다
                attr[run.range].font = .caption2.bold()
                attr[run.range].foregroundColor = .accentColor
                attr[run.range].underlineStyle = .none
            }
        }
        return attr
    }

    static func timeLabel(_ sec: Double) -> String {
        let s = Int(sec)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    /// 링크(=인용 칩) 런을 잘라 SeekChipAttribute 를 붙인 Text 로 이어 붙인다 —
    /// 렌더러가 이 표식을 보고 캡슐 배경을 그린다
    static func inlineText(_ raw: String, corrSpans: [CorrSpan]? = nil, spanColor: Color = .blue) -> Text {
        let attr = inlineAttributed(raw, corrSpans: corrSpans, spanColor: spanColor)
        var result = Text("")
        for run in attr.runs {
            let piece = Text(AttributedString(attr[run.range]))
            let tagged = run.link != nil ? piece.customAttribute(SeekChipAttribute()) : piece
            result = Text("\(result)\(tagged)")
        }
        return result
    }
}

// MARK: - 인용 칩 캡슐 렌더링

struct SeekChipAttribute: TextAttribute {}

/// 인용 칩 런 뒤에 둥근 캡슐을 칠하고 글리프는 그대로 그린다
struct SeekChipRenderer: TextRenderer {
    func draw(layout: Text.Layout, in ctx: inout GraphicsContext) {
        for line in layout {
            for run in line {
                if run[SeekChipAttribute.self] != nil {
                    let b = run.typographicBounds
                    let rect = CGRect(x: b.origin.x, y: b.origin.y - b.ascent,
                                      width: b.width, height: b.ascent + b.descent)
                        .insetBy(dx: -1, dy: -1)
                    ctx.fill(Capsule().path(in: rect), with: .color(Color.accentColor.opacity(0.14)))
                }
                ctx.draw(run)
            }
        }
    }
}

/// 앱 공용 인라인 텍스트 — 마크다운/수식/인용 칩(캡슐) 렌더링.
/// `Text(MarkdownText.inlineAttributed(_:))` 대신 이걸 쓴다
struct ChipText: View {
    let raw: String
    var corrSpans: [CorrSpan]?
    var spanColor: Color
    init(_ raw: String, corrSpans: [CorrSpan]? = nil, spanColor: Color = .blue) {
        self.raw = raw
        self.corrSpans = corrSpans
        self.spanColor = spanColor
    }
    var body: some View {
        MarkdownText.inlineText(raw, corrSpans: corrSpans, spanColor: spanColor)
            .textRenderer(SeekChipRenderer())
    }
}
