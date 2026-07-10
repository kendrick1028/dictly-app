// Runs after the app is packed but BEFORE code signing.
// Strips extended attributes (com.apple.provenance / FinderInfo / resource forks / quarantine)
// from the whole bundle — codesign rejects files carrying such "detritus" with
// "resource fork, Finder information, or similar detritus not allowed".
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  try {
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
    console.log(`  • afterPack: stripped extended attributes from ${appName}`)
  } catch (e) {
    console.warn(`  • afterPack: xattr strip failed: ${e.message}`)
  }
}
