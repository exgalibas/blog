import { getPostBySlug, getAllSlugs, formatDate, formatViews, getAllPosts } from '@/lib/posts'
import { remark } from 'remark'
import html from 'remark-html'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

export async function generateStaticParams() {
  const slugs = getAllSlugs()
  return slugs.map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = getPostBySlug(params.slug)
  if (!post) return { title: '文章未找到' }

  return {
    title: post.title,
    description: post.excerpt || post.title,
    openGraph: {
      title: post.title,
      description: post.excerpt || post.title,
      type: 'article',
      publishedTime: post.date,
      tags: post.tags,
    },
  }
}

async function markdownToHtml(markdown: string): Promise<string> {
  const result = await remark().use(html).process(markdown)
  return result.toString()
}

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug)

  if (!post) {
    notFound()
  }

  const contentHtml = await markdownToHtml(post.content)

  // 上一篇 / 下一篇
  const allPosts = getAllPosts()
  const currentIndex = allPosts.findIndex((p) => p.slug === params.slug)
  const prevPost = currentIndex < allPosts.length - 1 ? allPosts[currentIndex + 1] : null
  const nextPost = currentIndex > 0 ? allPosts[currentIndex - 1] : null

  return (
    <>
      {/* 返回链接 */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm mb-8 hover:opacity-80 transition-opacity"
        style={{ color: 'var(--color-accent)' }}
      >
        ← 返回首页
      </Link>

      {/* 文章头部 */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-3">{post.title}</h1>
        <div className="flex items-center gap-4 text-sm flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
          <time dateTime={post.date}>📅 {formatDate(post.date)}</time>
          <span>👁 {formatViews(post.views)} 次阅读</span>
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
      </header>

      {/* 分割线 */}
      <hr style={{ borderColor: 'var(--color-border)' }} className="mb-8" />

      {/* 文章内容 */}
      <article
        className="prose"
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />

      {/* 上下篇导航 */}
      <nav className="mt-12 pt-6 border-t grid grid-cols-2 gap-4" style={{ borderColor: 'var(--color-border)' }}>
        {prevPost ? (
          <Link
            href={`/posts/${prevPost.slug}`}
            className="group text-left"
          >
            <span className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>← 上一篇</span>
            <span className="text-sm font-medium group-hover:underline" style={{ color: 'var(--color-text)' }}>
              {prevPost.title}
            </span>
          </Link>
        ) : (
          <div />
        )}
        {nextPost ? (
          <Link
            href={`/posts/${nextPost.slug}`}
            className="group text-right"
          >
            <span className="text-xs block mb-1" style={{ color: 'var(--color-text-secondary)' }}>下一篇 →</span>
            <span className="text-sm font-medium group-hover:underline" style={{ color: 'var(--color-text)' }}>
              {nextPost.title}
            </span>
          </Link>
        ) : (
          <div />
        )}
      </nav>
    </>
  )
}
