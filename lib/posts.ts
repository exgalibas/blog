import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const postsDirectory = path.join(process.cwd(), 'content/posts')

export interface PostMeta {
  slug: string
  title: string
  date: string
  views: number
  tags: string[]
  excerpt: string
}

export interface Post extends PostMeta {
  content: string
}

export function getAllPosts(): PostMeta[] {
  const fileNames = fs.readdirSync(postsDirectory)
  const posts = fileNames
    .filter((name) => name.endsWith('.md'))
    .map((fileName) => {
      const slug = fileName.replace(/\.md$/, '')
      const fullPath = path.join(postsDirectory, fileName)
      const fileContents = fs.readFileSync(fullPath, 'utf8')
      const { data } = matter(fileContents)

      // 支持 published: false 隐藏文章（定时发布）
      const published = data.published !== false

      return {
        slug,
        title: data.title || slug,
        date: data.date || new Date().toISOString(),
        views: data.views || 0,
        tags: data.tags || [],
        excerpt: data.excerpt || '',
        published,
      } as PostMeta & { published: boolean }
    })
    // 过滤掉未发布文章（定时发布）
    .filter((post) => post.published)
    .map(({ published, ...rest }) => rest as PostMeta)

  // 按发布时间倒序
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getPostBySlug(slug: string): Post | null {
  try {
    const fullPath = path.join(postsDirectory, `${slug}.md`)
    const fileContents = fs.readFileSync(fullPath, 'utf8')
    const { data, content } = matter(fileContents)

    // 未发布文章不可访问
    if (data.published === false) return null

    return {
      slug,
      title: data.title || slug,
      date: data.date || new Date().toISOString(),
      views: data.views || 0,
      tags: data.tags || [],
      excerpt: data.excerpt || '',
      content,
    }
  } catch {
    return null
  }
}

export function getAllSlugs(): string[] {
  const fileNames = fs.readdirSync(postsDirectory)
  return fileNames
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
    .filter((name) => {
      // 排除未发布文章
      const fullPath = path.join(postsDirectory, `${name}.md`)
      const fileContents = fs.readFileSync(fullPath, 'utf8')
      const { data } = matter(fileContents)
      return data.published !== false
    })
}

export function getAllTags(): string[] {
  const posts = getAllPosts()
  const tagSet = new Set<string>()
  posts.forEach((post) => {
    post.tags.forEach((tag) => tagSet.add(tag))
  })
  return Array.from(tagSet).sort()
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatViews(views: number): string {
  if (views >= 10000) {
    return `${(views / 10000).toFixed(1)}万`
  }
  return views.toLocaleString()
}
