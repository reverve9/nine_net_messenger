import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nine Net Messenger',
  description: 'Nine Net 메신저',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
