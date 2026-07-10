// Regenerate the macOS app icon from a source logo.
// Bakes a white squircle (macOS-style): 824×824 rounded-rect (r=185) centered on a 1024 transparent
// canvas (100px margin), then sips/iconutil → build/icon.icns. Usage: node scripts/make-icon.cjs [src.png]
const sharp = require('sharp')
const { execSync } = require('child_process')
const fs = require('fs')

const SRC = process.argv[2] || 'new-logo/logo-whitebackground.png'
const SIZE = 1024
const AREA = 824
const RADIUS = 185
const MARGIN = (SIZE - AREA) / 2

async function main() {
  const mask = Buffer.from(`<svg width="${AREA}" height="${AREA}"><rect width="${AREA}" height="${AREA}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`)
  // keep the source's own (gradient) background — do NOT flatten to white
  const logo = await sharp(SRC).resize(AREA, AREA, { fit: 'cover' }).toBuffer()
  const squircled = await sharp(logo).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: squircled, left: MARGIN, top: MARGIN }])
    .png()
    .toFile('build/icon.png')
  console.log('wrote build/icon.png from', SRC)

  const ICONSET = '/tmp/Dictly.iconset'
  fs.rmSync(ICONSET, { recursive: true, force: true })
  fs.mkdirSync(ICONSET, { recursive: true })
  const map = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]
  for (const [px, name] of map) execSync(`sips -z ${px} ${px} build/icon.png --out ${ICONSET}/${name}`, { stdio: 'ignore' })
  execSync(`iconutil -c icns ${ICONSET} -o build/icon.icns`)
  console.log('wrote build/icon.icns')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
