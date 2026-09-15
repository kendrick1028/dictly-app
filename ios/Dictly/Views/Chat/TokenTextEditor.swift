import SwiftUI
import UIKit

/// 에디터에 밖에서 명령을 내리는 손잡이 — 뷰 업데이트 사이클을 우회해 즉시 삽입한다
@MainActor
final class TokenEditorController {
    weak var textView: UITextView?
    weak var coordinator: TokenTextEditor.Coordinator?

    func insert(_ ref: ChatRef) {
        guard let tv = textView else { return }
        coordinator?.insert(ref, into: tv)
    }
}

/// 인용 토큰(파란 아이콘+이름)을 텍스트와 한 흐름으로 편집하는 입력 필드.
/// 토큰은 NSTextAttachment 라 한 글자처럼 취급된다 — 백스페이스 한 번에 통째로 지워진다.
struct TokenTextEditor: UIViewRepresentable {
    @Binding var text: NSAttributedString
    @Binding var height: CGFloat
    /// 캐럿 앞의 "@질의" (없으면 nil) — 멘션 서제스천 트리거
    @Binding var mentionQuery: String?
    var controller: TokenEditorController
    var placeholder: String

    static let font = UIFont.systemFont(ofSize: 17)
    static let maxHeight: CGFloat = 128

    static func typingAttributes() -> [NSAttributedString.Key: Any] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 4
        return [.font: font, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
    }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.backgroundColor = .clear
        tv.font = Self.font
        tv.textColor = .label
        tv.tintColor = .label
        tv.isScrollEnabled = false
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        tv.typingAttributes = Self.typingAttributes()
        tv.delegate = context.coordinator

        let ph = UILabel()
        ph.text = placeholder
        ph.font = Self.font
        ph.textColor = .tertiaryLabel
        ph.tag = 99
        ph.translatesAutoresizingMaskIntoConstraints = false
        tv.addSubview(ph)
        NSLayoutConstraint.activate([
            ph.leadingAnchor.constraint(equalTo: tv.leadingAnchor),
            ph.topAnchor.constraint(equalTo: tv.topAnchor, constant: 1)
        ])
        controller.textView = tv
        controller.coordinator = context.coordinator
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        if !tv.attributedText.isEqual(to: text) {
            tv.attributedText = text
            tv.typingAttributes = Self.typingAttributes()
        }
        context.coordinator.sync(tv)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: TokenTextEditor
        init(_ parent: TokenTextEditor) { self.parent = parent }

        func textViewDidChange(_ tv: UITextView) {
            parent.text = tv.attributedText
            sync(tv)
        }

        func textViewDidChangeSelection(_ tv: UITextView) {
            updateMention(tv)
        }

        func sync(_ tv: UITextView) {
            (tv.viewWithTag(99) as? UILabel)?.isHidden = tv.attributedText.length > 0
            let width = tv.bounds.width > 0 ? tv.bounds.width : UIScreen.main.bounds.width - 90
            let size = tv.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
            let h = min(max(size.height, TokenTextEditor.font.lineHeight + 6), TokenTextEditor.maxHeight)
            tv.isScrollEnabled = size.height > TokenTextEditor.maxHeight
            if abs(parent.height - h) > 0.5 {
                DispatchQueue.main.async { self.parent.height = h }
            }
            updateMention(tv)
        }

        private func updateMention(_ tv: UITextView) {
            let query = Self.mentionRange(in: tv).map { range in
                (tv.attributedText.string as NSString).substring(with: NSRange(location: range.location + 1, length: range.length - 1))
            }
            if parent.mentionQuery != query {
                DispatchQueue.main.async { self.parent.mentionQuery = query }
            }
        }

        /// 캐럿 바로 앞의 "@질의" 전체 범위(@ 포함). 공백/토큰을 만나면 중단.
        static func mentionRange(in tv: UITextView) -> NSRange? {
            let caret = tv.selectedRange.location
            let ns = tv.attributedText.string as NSString
            guard caret > 0, caret <= ns.length else { return nil }
            var i = caret - 1
            while i >= 0 {
                let unit = ns.character(at: i)
                if unit == 0xFFFC { return nil } // 토큰(첨부) 경계
                guard let scalar = UnicodeScalar(unit) else { return nil }
                let ch = Character(scalar)
                if ch == "@" {
                    if i > 0, let prevScalar = UnicodeScalar(ns.character(at: i - 1)) {
                        let prev = Character(prevScalar)
                        guard prev.isWhitespace || prev.isNewline else { return nil }
                    }
                    return NSRange(location: i, length: caret - i)
                }
                if ch.isWhitespace || ch.isNewline { return nil }
                i -= 1
            }
            return nil
        }

        /// 토큰 삽입 — 활성 "@질의"가 있으면 그 자리를 치환한다
        func insert(_ ref: ChatRef, into tv: UITextView) {
            let attachment = RefAttachment(ref: ref)
            let token = NSMutableAttributedString(attachment: attachment)
            token.addAttributes([.font: TokenTextEditor.font], range: NSRange(location: 0, length: token.length))
            token.append(NSAttributedString(string: " ", attributes: TokenTextEditor.typingAttributes()))

            let content = NSMutableAttributedString(attributedString: tv.attributedText)
            var caret = tv.selectedRange.location
            if let queryRange = Self.mentionRange(in: tv) {
                content.replaceCharacters(in: queryRange, with: token)
                caret = queryRange.location + token.length
            } else {
                caret = min(caret, content.length)
                content.insert(token, at: caret)
                caret += token.length
            }
            tv.attributedText = content
            tv.selectedRange = NSRange(location: caret, length: 0)
            tv.typingAttributes = TokenTextEditor.typingAttributes()
            textViewDidChange(tv)
        }
    }
}

/// 파란 인용 토큰 — ChatRef 를 품은 텍스트 첨부
final class RefAttachment: NSTextAttachment {
    let ref: ChatRef

    init(ref: ChatRef) {
        self.ref = ref
        super.init(data: nil, ofType: nil)
        let rendered = Self.render(ref: ref)
        image = rendered
        let font = TokenTextEditor.font
        bounds = CGRect(x: 0, y: font.descender, width: rendered.size.width, height: font.lineHeight)
    }

    required init?(coder: NSCoder) { fatalError("unsupported") }

    private static func render(ref: ChatRef) -> UIImage {
        let font = UIFont.systemFont(ofSize: 16.5, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.systemBlue]
        let name = ref.name as NSString
        var textSize = name.size(withAttributes: attrs)
        textSize.width = min(ceil(textSize.width), 210)

        let iconConfig = UIImage.SymbolConfiguration(pointSize: 13.5, weight: .semibold)
        let symbol = ref.isFolder ? "folder.fill" : "doc.text.fill"
        let icon = (UIImage(systemName: symbol, withConfiguration: iconConfig) ?? UIImage())
            .withTintColor(.systemBlue, renderingMode: .alwaysOriginal)

        let height = TokenTextEditor.font.lineHeight
        let width = icon.size.width + 5 + textSize.width
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height))
        return renderer.image { _ in
            icon.draw(at: CGPoint(x: 0, y: (height - icon.size.height) / 2))
            name.draw(in: CGRect(x: icon.size.width + 5,
                                 y: (height - textSize.height) / 2,
                                 width: textSize.width, height: textSize.height),
                      withAttributes: attrs)
        }
    }
}

extension NSAttributedString {
    /// (마커 직렬화 텍스트, 순서대로의 인용 refs) — 토큰은 ⟦F|이름⟧/⟦N|이름⟧ 마커가 된다
    var chatSerialized: (text: String, refs: [ChatRef]) {
        var out = ""
        var refs: [ChatRef] = []
        let ns = string as NSString
        enumerateAttribute(.attachment, in: NSRange(location: 0, length: length)) { value, range, _ in
            if let attachment = value as? RefAttachment {
                out += ChatTokenMarker.marker(for: attachment.ref)
                refs.append(attachment.ref)
            } else {
                out += ns.substring(with: range)
            }
        }
        return (out, refs)
    }
}
