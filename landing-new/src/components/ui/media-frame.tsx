'use client'

import { cn } from '@/lib/utils'

interface MediaFrameProps {
  type: 'video' | 'image'
  src: string
  poster?: string
  alt?: string
  className?: string
  /** show faux macOS window dots */
  chrome?: boolean
}

/** Glass-framed media (looping muted video or image) for feature showcases. */
export function MediaFrame({ type, src, poster, alt = '', className, chrome = true }: MediaFrameProps) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl glass glass-sheen p-1.5',
        className,
      )}
    >
      {chrome && (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
        {type === 'video' ? (
          <video
            className="block w-full"
            src={src}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onCanPlay={(e) => void e.currentTarget.play().catch(() => {})}
          />
        ) : (
          <img className="block w-full" src={src} alt={alt} loading="lazy" decoding="async" />
        )}
      </div>
    </div>
  )
}
