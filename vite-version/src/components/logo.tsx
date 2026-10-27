import * as React from "react"

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number
}

/** Original Omega mark traced directly from the exact user-supplied image; geometry preserved. */
const omegaPath = "M 152 49 L 115 80 L 111 85 L 63 127 L 53 141 L 51 147 L 50 163 L 50 308 L 52 320 L 56 329 L 61 336 L 113 387 L 130 396 L 325 397 L 338 395 L 348 390 L 356 384 L 406 334 L 409 329 L 415 312 L 415 256 L 338 256 L 337 322 L 129 322 L 128 121 L 130 119 L 341 119 L 343 121 L 202 257 L 197 268 L 197 273 L 200 281 L 209 288 L 275 289 L 284 285 L 408 164 L 414 154 L 417 142 L 417 131 L 412 115 L 406 106 L 356 57 L 340 47 L 332 45 L 164 45 Z"

export function Logo({ size = 32, className, ...props }: LogoProps) {
  const gradientId = React.useId().replace(/:/g, "")
  return (
    <svg
      width={size}
      height={size * 434 / 473}
      viewBox="0 0 473 434"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Omega Solutions"
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#059669" />
          <stop offset=".48" stopColor="#34D399" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
      </defs>
      <path d={omegaPath} fill={`url(#${gradientId})`} />
    </svg>
  )
}
