import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 4,
          backgroundColor: '#f5a623',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#1c2d4a',
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}
        >
          ER
        </span>
      </div>
    ),
    { ...size }
  )
}
