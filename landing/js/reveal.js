/* Dictly landing — scroll reveals, sticky nav, download wiring. */
(function () {
  // ⬇⬇⬇  DMG 다운로드 주소를 여기에 넣으세요 (예: GitHub Releases 의 .dmg URL).
  //      비워두면(placeholder '#') 다운로드 버튼은 다운로드 섹션으로 스크롤 + 안내만 합니다.
  const DMG_URL = '#'

  // ---- scroll reveal ----
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }
      })
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  )
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el))

  // ---- sticky nav ----
  const nav = document.getElementById('nav')
  const hero = document.querySelector('.hero')
  function onScroll() {
    const trigger = hero ? hero.offsetHeight - 120 : window.innerHeight
    nav.classList.toggle('is-stuck', window.scrollY > trigger)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  // ---- tiny toast ----
  function toast(msg) {
    let t = document.getElementById('toast')
    if (!t) {
      t = document.createElement('div')
      t.id = 'toast'
      t.style.cssText =
        'position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(20px);background:#14132e;color:#fff;padding:13px 22px;border-radius:999px;font-size:14px;font-weight:600;z-index:999;opacity:0;transition:.3s;box-shadow:0 12px 40px -10px rgba(0,0,0,.5);pointer-events:none'
      document.body.appendChild(t)
    }
    t.textContent = msg
    requestAnimationFrame(() => {
      t.style.opacity = '1'
      t.style.transform = 'translateX(-50%) translateY(0)'
    })
    clearTimeout(t._h)
    t._h = setTimeout(() => {
      t.style.opacity = '0'
      t.style.transform = 'translateX(-50%) translateY(20px)'
    }, 2600)
  }

  // ---- download buttons ----
  const dls = document.querySelectorAll('.js-download')
  const ready = DMG_URL && DMG_URL !== '#'
  dls.forEach((a) => {
    if (ready) {
      a.href = DMG_URL
      a.setAttribute('download', '')
    } else {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        document.getElementById('download').scrollIntoView({ behavior: 'smooth' })
        toast('다운로드 링크는 곧 연결됩니다 — DMG 호스팅 후 활성화')
      })
    }
  })
})()
