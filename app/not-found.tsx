import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-6xl font-bold mb-4">404</h1>
      <p className="text-lg mb-8" style={{ color: 'var(--color-text-secondary)' }}>
        页面未找到
      </p>
      <Link
        href="/"
        className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors"
        style={{ backgroundColor: 'var(--color-accent)' }}
      >
        返回首页
      </Link>
    </div>
  )
}
