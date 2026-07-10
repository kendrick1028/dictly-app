// Dictly hero — scroll-driven particle morph.
// Three tool-clusters (record / annotate / study) drift together and rise into one glowing
// summit (space → dawn). Driven by GSAP ScrollTrigger over the tall .hero wrapper.
import * as THREE from 'three'

const canvas = document.getElementById('hero-canvas')
const heroEl = document.querySelector('.hero')

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const smallScreen = window.innerWidth < 760

// ---- WebGL capability check + fallback ----
function webglOK() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

if (prefersReduced || smallScreen || !webglOK()) {
  document.body.classList.add('no3d')
  if (heroEl) heroEl.style.height = '100svh'
} else {
  initHero()
}

function initHero() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  const DPR = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(DPR)

  const scene = new THREE.Scene()
  const spaceCol = new THREE.Color(0x05041a)
  const dawnCol = new THREE.Color(0x231a4a)
  scene.background = spaceCol.clone()

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
  camera.position.set(0, 0.2, 9)

  // ---------- particle field ----------
  const COUNT = 5400
  const PER = Math.floor(COUNT / 3)
  const cluster = new Float32Array(COUNT * 3)
  const converge = new Float32Array(COUNT * 3)
  const summit = new Float32Array(COUNT * 3)
  const color = new Float32Array(COUNT * 3)
  const size = new Float32Array(COUNT)
  const rand = new Float32Array(COUNT)

  const toolCenters = [
    new THREE.Vector3(-4.6, 2.1, -0.4), // record
    new THREE.Vector3(4.6, 1.7, -0.6), // annotate
    new THREE.Vector3(0.0, -3.0, 0.2) // study
  ]
  const toolColors = [new THREE.Color(0x5b8cff), new THREE.Color(0x34e0c8), new THREE.Color(0xb07cff)]

  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) // ~N(0,~0.5)
  const SUMMIT_H = 6.2
  const SUMMIT_R = 3.0
  const baseY = -2.6

  for (let i = 0; i < COUNT; i++) {
    const tool = Math.min(2, Math.floor(i / PER))
    const c = toolCenters[tool]
    // cluster: fuzzy sphere around the tool center
    cluster[i * 3] = c.x + gauss() * 1.25
    cluster[i * 3 + 1] = c.y + gauss() * 1.25
    cluster[i * 3 + 2] = c.z + gauss() * 1.0

    // converge: loose shell around the middle
    const u = Math.random() * Math.PI * 2
    const v = Math.acos(2 * Math.random() - 1)
    const cr = 1.5 + Math.random() * 0.6
    converge[i * 3] = Math.sin(v) * Math.cos(u) * cr
    converge[i * 3 + 1] = 0.3 + Math.cos(v) * cr
    converge[i * 3 + 2] = Math.sin(v) * Math.sin(u) * cr

    // summit: a ridged cone/peak — thin surface shell so additive glow doesn't blow out
    const h = Math.random() // 0 = base, 1 = peak (uniform along height)
    const ang = Math.random() * Math.PI * 2
    const ridge = 1 + Math.sin(ang * 5) * 0.12 + (Math.random() - 0.5) * 0.16
    const rr = SUMMIT_R * (1 - h) * (0.82 + Math.random() * 0.18) * ridge
    summit[i * 3] = Math.cos(ang) * rr
    summit[i * 3 + 1] = baseY + h * SUMMIT_H + (Math.random() - 0.5) * 0.2
    summit[i * 3 + 2] = Math.sin(ang) * rr

    color[i * 3] = toolColors[tool].r
    color[i * 3 + 1] = toolColors[tool].g
    color[i * 3 + 2] = toolColors[tool].b
    size[i] = 3 + Math.random() * 5.5
    rand[i] = Math.random()
  }
  // a few aurora sparks floating above the peak
  for (let i = 0; i < 220; i++) {
    const idx = i
    summit[idx * 3] = (Math.random() - 0.5) * 4
    summit[idx * 3 + 1] = baseY + SUMMIT_H + Math.random() * 2.2
    summit[idx * 3 + 2] = (Math.random() - 0.5) * 4
    size[idx] = 5 + Math.random() * 8
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('aCluster', new THREE.BufferAttribute(cluster, 3))
  geo.setAttribute('aConverge', new THREE.BufferAttribute(converge, 3))
  geo.setAttribute('aSummit', new THREE.BufferAttribute(summit, 3))
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1))
  geo.setAttribute('position', new THREE.BufferAttribute(cluster.slice(), 3)) // placeholder

  const uniforms = {
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uPixelRatio: { value: DPR }
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aCluster; attribute vec3 aConverge; attribute vec3 aSummit;
      attribute vec3 aColor; attribute float aSize; attribute float aRand;
      uniform float uProgress; uniform float uTime; uniform float uPixelRatio;
      varying vec3 vColor; varying float vGlow;
      void main(){
        float p1 = smoothstep(0.0, 0.62, uProgress);
        float p2 = smoothstep(0.42, 1.0, uProgress);
        vec3 pos = mix(aCluster, aConverge, p1);
        pos = mix(pos, aSummit, p2);
        float drift = (1.0 - p2);
        pos.x += sin(uTime*0.3 + aRand*6.28) * drift * 0.18;
        pos.y += cos(uTime*0.24 + aRand*6.28) * drift * 0.18;

        vec3 summitCol = mix(vec3(0.42,0.86,1.0), vec3(1.0,0.80,0.40), smoothstep(-2.5, 3.2, aSummit.y));
        vec3 c = mix(aColor, vec3(1.0), p1*0.55);
        c = mix(c, summitCol, p2);
        vColor = c;
        vGlow = 0.35 + 0.65*p2;

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float twinkle = 0.75 + 0.25*sin(uTime*2.0 + aRand*30.0);
        gl_PointSize = aSize * uPixelRatio * (300.0 / max(-mv.z, 0.1)) * twinkle * 0.34;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vGlow;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if(d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        a = pow(a, 1.8);
        gl_FragColor = vec4(vColor * (0.8 + vGlow*0.28), a * (0.16 + vGlow*0.24));
      }
    `
  })

  const points = new THREE.Points(geo, mat)
  scene.add(points)

  // ---------- starfield ----------
  const STAR = 1600
  const sPos = new Float32Array(STAR * 3)
  for (let i = 0; i < STAR; i++) {
    const r = 26 + Math.random() * 30
    const t = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    sPos[i * 3] = r * Math.sin(ph) * Math.cos(t)
    sPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(t)
    sPos[i * 3 + 2] = r * Math.cos(ph) - 10
  }
  const sGeo = new THREE.BufferGeometry()
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
  const stars = new THREE.Points(
    sGeo,
    new THREE.PointsMaterial({ color: 0x9fb0ff, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false })
  )
  scene.add(stars)

  // ---------- scroll progress ----------
  let target = 0
  let cur = 0
  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger)
    ScrollTrigger.create({
      trigger: heroEl,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => (target = self.progress)
    })
  } else {
    // fallback: derive from window scroll
    const onScroll = () => {
      const rect = heroEl.getBoundingClientRect()
      const total = heroEl.offsetHeight - window.innerHeight
      target = Math.min(1, Math.max(0, -rect.top / total))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  // ---------- mouse parallax ----------
  let mx = 0
  let my = 0
  window.addEventListener('pointermove', (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2
    my = (e.clientY / window.innerHeight - 0.5) * 2
  })

  // ---------- resize ----------
  function resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  // ---------- render loop ----------
  const clock = new THREE.Clock()
  let visible = true
  if (heroEl && 'IntersectionObserver' in window) {
    new IntersectionObserver((es) => (visible = es[0].isIntersecting), { threshold: 0 }).observe(heroEl)
  }

  function tick() {
    requestAnimationFrame(tick)
    if (!visible) return
    cur += (target - cur) * 0.08
    uniforms.uProgress.value = cur
    uniforms.uTime.value = clock.getElapsedTime()

    // background space → dawn
    scene.background.copy(spaceCol).lerp(dawnCol, cur)

    // camera: ease up toward the peak + subtle parallax
    const camY = 0.2 + cur * 1.6
    const camZ = 9 - cur * 1.2
    camera.position.x += (mx * 0.6 - camera.position.x) * 0.05
    camera.position.y += (camY - my * 0.4 - camera.position.y) * 0.05
    camera.position.z += (camZ - camera.position.z) * 0.05
    camera.lookAt(0, 0.4 + cur * 1.4, 0)

    points.rotation.y = Math.sin(clock.getElapsedTime() * 0.05) * 0.15 * (1 - cur) + cur * 0.0
    stars.rotation.y += 0.0004
    stars.rotation.x += 0.0001

    renderer.render(scene, camera)
  }
  tick()
}
