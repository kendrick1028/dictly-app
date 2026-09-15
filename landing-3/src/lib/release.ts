import { useEffect, useState } from 'react'
import { DMG_URL, EXE_URL, APP_VERSION } from '@/content'

const RELEASES_API = 'https://api.github.com/repos/kendrick1028/dictly-app/releases/latest'

export interface Release {
  version: string
  /** macOS (Apple Silicon) disk image */
  dmgUrl: string
  /** Windows x64 NSIS installer — null until a release ships one */
  exeUrl: string | null
  /** the installer for the visitor's own OS (Windows → exe when available, otherwise dmg) */
  primaryUrl: string
  primaryOs: 'mac' | 'windows'
}

/** cheap UA sniff — only used to pick which installer the main buttons point at */
export const isWindowsVisitor = (): boolean => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

function withPrimary(r: Omit<Release, 'primaryUrl' | 'primaryOs'>): Release {
  const win = isWindowsVisitor() && !!r.exeUrl
  return { ...r, primaryUrl: win ? (r.exeUrl as string) : r.dmgUrl, primaryOs: win ? 'windows' : 'mac' }
}

/**
 * Follow the newest GitHub release. The app publishes every build to kendrick1028/dictly-app
 * (the same feed its auto-updater reads), so the download buttons and the version labels track
 * new releases without touching this site. The constants in content.ts are the offline fallback
 * — they render immediately and are replaced once the API answers.
 */
export function useLatestRelease(): Release {
  const [release, setRelease] = useState<Release>(() => withPrimary({ version: APP_VERSION, dmgUrl: DMG_URL, exeUrl: EXE_URL }))

  useEffect(() => {
    let alive = true
    fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rel: { tag_name?: string; assets?: { name: string; browser_download_url: string }[] }) => {
        if (!alive) return
        const assets = rel.assets ?? []
        const dmg = assets.find((a) => a.name.endsWith('.dmg'))
        const exe = assets.find((a) => a.name.endsWith('.exe'))
        setRelease((prev) =>
          withPrimary({
            version: rel.tag_name ?? prev.version,
            dmgUrl: dmg?.browser_download_url ?? prev.dmgUrl,
            // a release that has no Windows build yet must not keep advertising an older exe
            exeUrl: exe?.browser_download_url ?? null
          })
        )
      })
      .catch(() => {
        /* offline or rate-limited → keep the pinned fallback */
      })
    return () => {
      alive = false
    }
  }, [])

  return release
}
