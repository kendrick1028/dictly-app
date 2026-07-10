import { cn } from '@/lib/utils'

interface VideoFrameProps {
  src: string // slug under /media
  className?: string
  bar?: boolean
  rounded?: boolean
}

/** Clean, light bordered video frame (Swiss). Looping muted autoplay screen-recording. */
export function VideoFrame({ src, className, bar = true, rounded = true }: VideoFrameProps) {
  return (
    <div className={cn('frame', !rounded && 'rounded-xl', className)}>
      {bar && (
        <div className="frame__bar">
          <span className="frame__dot" />
          <span className="frame__dot" />
          <span className="frame__dot" />
        </div>
      )}
      <video
        className="block w-full"
        poster={`/media/${src}.jpg`}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onCanPlay={(e) => void e.currentTarget.play().catch(() => {})}
      >
        <source src={`/media/${src}.mp4`} type="video/mp4" />
      </video>
    </div>
  )
}
