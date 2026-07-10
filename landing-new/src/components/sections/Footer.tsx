export function Footer() {
  return (
    <footer className="border-t border-white/10 px-5 py-12 text-center">
      <div className="inline-flex items-center gap-2.5 font-bold">
        <img src="/media/logo.png" alt="Dictly" className="h-6 w-6 rounded-md" />
        <span className="text-[17px] tracking-tight">Dictly</span>
      </div>
      <p className="mt-3 text-sm text-white/55">강의의 처음부터 복습까지, 하나로.</p>
      <p className="mt-2 text-xs text-white/35">© 2026 Dictly · 로컬 Whisper 기반 학습 노트 앱 · macOS</p>
    </footer>
  )
}
