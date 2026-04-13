import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Blog — 记录想法、分享经验',
    template: '%s | Blog',
  },
  description: '一个基于 Next.js 的个人博客，记录想法、分享经验。',
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    siteName: 'Blog',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b sticky top-0 z-10 backdrop-blur-md" style={{ borderColor: 'var(--color-border)', backgroundColor: 'rgba(var(--color-bg-rgb), 0.8)' }}>
            <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
              <a href="/" className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity" style={{ color: 'var(--color-text)' }}>
                📝 Blog
              </a>
              <nav className="flex gap-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <a href="/" className="hover:opacity-80 transition-opacity">首页</a>
                <a href="/about" className="hover:opacity-80 transition-opacity">关于</a>
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">GitHub</a>
              </nav>
            </div>
          </header>
          <main className="flex-1">
            <div className="max-w-3xl mx-auto px-6 py-8">
              {children}
            </div>
          </main>
          <footer className="border-t py-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <p>© {new Date().getFullYear()} Blog · Powered by Next.js</p>
          </footer>
        </div>
      </body>
    </html>
  )
}
