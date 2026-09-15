import SwiftUI

/// Lightweight native LaTeX typesetter for inline `$...$` math.
/// Renders greek letters, sub/superscripts (real baseline offsets), \frac, \sqrt
/// and common operators as a serif AttributedString that flows inside any Text.
enum MathTypeset {
    private static let symbols: [String: String] = [
        "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε",
        "zeta": "ζ", "eta": "η", "theta": "θ", "iota": "ι", "kappa": "κ", "lambda": "λ",
        "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ",
        "upsilon": "υ", "phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
        "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π",
        "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
        "times": "×", "cdot": "·", "div": "÷", "pm": "±", "mp": "∓",
        "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥", "ne": "≠", "neq": "≠",
        "approx": "≈", "sim": "∼", "equiv": "≡", "propto": "∝",
        "infty": "∞", "partial": "∂", "nabla": "∇", "sum": "∑", "prod": "∏", "int": "∫",
        "rightarrow": "→", "to": "→", "leftarrow": "←", "Rightarrow": "⇒", "Leftarrow": "⇐",
        "in": "∈", "notin": "∉", "subset": "⊂", "supset": "⊃", "cup": "∪", "cap": "∩",
        "forall": "∀", "exists": "∃", "emptyset": "∅", "ldots": "…", "cdots": "⋯",
        "prime": "′", "degree": "°", "%": "%", "&": "&", "#": "#", "_": "_", "{": "{", "}": "}"
    ]

    /// typeset one math expression (without the $ delimiters)
    static func typeset(_ latex: String, size: CGFloat = 16) -> AttributedString {
        var input = Substring(latex)
        return parseSequence(&input, size: size, until: nil)
    }

    // MARK: parser

    private static func parseSequence(_ s: inout Substring, size: CGFloat, until stop: Character?) -> AttributedString {
        var out = AttributedString()
        while let c = s.first {
            if let stop, c == stop {
                s.removeFirst()
                return out
            }
            out += parseAtom(&s, size: size)
        }
        return out
    }

    /// consume exactly one atom: \command, _x, ^x, {group}, or a single character
    private static func parseAtom(_ s: inout Substring, size: CGFloat) -> AttributedString {
        guard let c = s.first else { return AttributedString() }
        s.removeFirst()
        switch c {
        case "\\":
            let word = s.prefix(while: { $0.isLetter })
            s.removeFirst(word.count)
            let cmd = String(word)
            if cmd.isEmpty {
                // escaped char like \, \; \\ — emit thin space
                if let n = s.first, !n.isLetter, !n.isNumber { s.removeFirst() }
                return plain(" ", size: size)
            }
            switch cmd {
            case "frac", "dfrac", "tfrac":
                let num = parseGroup(&s, size: size)
                let den = parseGroup(&s, size: size)
                return num + plain("∕", size: size) + den
            case "sqrt":
                return plain("√(", size: size) + parseGroup(&s, size: size) + plain(")", size: size)
            case "text", "mathrm", "mathbf", "operatorname":
                return parseGroup(&s, size: size)
            case "left", "right", "displaystyle":
                return AttributedString()
            default:
                if let sym = symbols[cmd] {
                    return plain(sym, size: size)
                }
                return letters(cmd, size: size) // unknown command → show its name
            }
        case "_":
            var sub = parseGroupOrAtom(&s, size: size * 0.72)
            sub.baselineOffset = -size * 0.2
            return sub
        case "^":
            var sup = parseGroupOrAtom(&s, size: size * 0.72)
            sup.baselineOffset = size * 0.38
            return sup
        case "{":
            return parseSequence(&s, size: size, until: "}")
        case "}":
            return AttributedString()
        default:
            return styled(c, size: size)
        }
    }

    private static func parseGroup(_ s: inout Substring, size: CGFloat) -> AttributedString {
        while s.first == " " { s.removeFirst() }
        guard s.first == "{" else { return parseAtom(&s, size: size) }
        s.removeFirst()
        return parseSequence(&s, size: size, until: "}")
    }

    private static func parseGroupOrAtom(_ s: inout Substring, size: CGFloat) -> AttributedString {
        parseGroup(&s, size: size)
    }

    // MARK: styling

    private static func styled(_ c: Character, size: CGFloat) -> AttributedString {
        var a = AttributedString(String(c))
        if c.isLetter {
            a.font = .system(size: size, design: .serif).italic()
        } else {
            a.font = .system(size: size, design: .serif)
        }
        return a
    }

    private static func letters(_ text: String, size: CGFloat) -> AttributedString {
        text.reduce(into: AttributedString()) { acc, c in acc += styled(c, size: size) }
    }

    private static func plain(_ text: String, size: CGFloat) -> AttributedString {
        var a = AttributedString(text)
        a.font = .system(size: size, design: .serif)
        return a
    }
}
