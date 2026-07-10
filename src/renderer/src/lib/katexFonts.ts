// Base64-embedded KaTeX webfonts for SELF-CONTAINED HTML export. katex.min.css declares its
// @font-face with relative `fonts/…` URLs that don't resolve in a standalone .html file, so math
// (esp. fractions / large delimiters) breaks. We re-declare the same families with data-URI src so
// the exported file renders math fully offline. Dynamically imported (kept out of the main bundle).
import AMS_Regular from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline'
import Caligraphic_Bold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline'
import Caligraphic_Regular from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline'
import Fraktur_Bold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline'
import Fraktur_Regular from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline'
import Main_Bold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?inline'
import Main_BoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline'
import Main_Italic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?inline'
import Main_Regular from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?inline'
import Math_BoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline'
import Math_Italic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?inline'
import SansSerif_Bold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline'
import SansSerif_Italic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline'
import SansSerif_Regular from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline'
import Script_Regular from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?inline'
import Size1_Regular from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline'
import Size2_Regular from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline'
import Size3_Regular from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline'
import Size4_Regular from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline'
import Typewriter_Regular from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline'

type Face = [family: string, weight: string, style: string, uri: string]

const FACES: Face[] = [
  ['KaTeX_AMS', 'normal', 'normal', AMS_Regular],
  ['KaTeX_Caligraphic', 'bold', 'normal', Caligraphic_Bold],
  ['KaTeX_Caligraphic', 'normal', 'normal', Caligraphic_Regular],
  ['KaTeX_Fraktur', 'bold', 'normal', Fraktur_Bold],
  ['KaTeX_Fraktur', 'normal', 'normal', Fraktur_Regular],
  ['KaTeX_Main', 'bold', 'normal', Main_Bold],
  ['KaTeX_Main', 'bold', 'italic', Main_BoldItalic],
  ['KaTeX_Main', 'normal', 'italic', Main_Italic],
  ['KaTeX_Main', 'normal', 'normal', Main_Regular],
  ['KaTeX_Math', 'bold', 'italic', Math_BoldItalic],
  ['KaTeX_Math', 'normal', 'italic', Math_Italic],
  ['KaTeX_SansSerif', 'bold', 'normal', SansSerif_Bold],
  ['KaTeX_SansSerif', 'normal', 'italic', SansSerif_Italic],
  ['KaTeX_SansSerif', 'normal', 'normal', SansSerif_Regular],
  ['KaTeX_Script', 'normal', 'normal', Script_Regular],
  ['KaTeX_Size1', 'normal', 'normal', Size1_Regular],
  ['KaTeX_Size2', 'normal', 'normal', Size2_Regular],
  ['KaTeX_Size3', 'normal', 'normal', Size3_Regular],
  ['KaTeX_Size4', 'normal', 'normal', Size4_Regular],
  ['KaTeX_Typewriter', 'normal', 'normal', Typewriter_Regular],
]

/** @font-face block (data-URI src) that overrides katex.min.css's relative font URLs. */
export const KATEX_FONT_FACES: string = FACES.map(
  ([family, weight, style, uri]) =>
    `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(${uri}) format('woff2');}`,
).join('\n')
