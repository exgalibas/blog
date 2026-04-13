import { getAllPosts, formatDate, formatViews, getAllTags } from '@/lib/posts'
import Link from 'next/link'

export default function Home() {
  const posts = getAllPosts()
  const tags = getAllTags()

  return (
    <>
      {/* Hero */}
      <section className="mb-12">
        <h1 className="text-3xl font-bold mb-2">✍️ 博客</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          记录想法、分享经验
        </p>
      </section>

      {/* 标签云 */}
      {tags.length > 0 && (
        <section className="mb-10">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 rounded-full text-sm cursor-default transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: 'var(--color-tag-bg)',
                  color: 'var(--color-tag-text)',
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 文章列表 */}
      <section>
        {posts.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>暂无文章</p>
        ) : (
          <div className="space-y-8">
            {posts.map((post) => (
              <article key={post.slug} className="group">
                <Link href={`/posts/${post.slug}`} className="block">
                  <h2 className="text-xl font-semibold mb-2 group-hover:underline underline-offset-4" style={{ color: 'var(--color-text)' }}>
                    {post.title}
                  </h2>
                  {post.excerpt && (
                    <p className="mb-3 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>
                      {post.excerpt}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-sm flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
                    <time dateTime={post.date}>📅 {formatDate(post.date)}</time>
                    <span>👁 {formatViews(post.views)}</span>
                    {post.tags.length > 0 && (
                      <div className="flex gap-2">
                        {post.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded-full text-xs"
                            style={{
                              backgroundColor: 'var(--color-tag-bg)',
                              color: 'var(--color-tag-text)',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
