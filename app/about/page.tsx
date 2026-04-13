import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '关于',
  description: '关于这个博客和作者',
}

export default function AboutPage() {
  return (
    <>
      <h1 className="text-3xl font-bold mb-6">👋 关于</h1>

      <div className="prose">
        <h2>关于这个博客</h2>
        <p>
          这是一个基于 <strong>Next.js 14</strong> 构建的个人博客，使用 Markdown 文件作为内容源。
        </p>
        <p>技术栈：</p>
        <ul>
          <li><strong>框架</strong>：Next.js 14 (App Router)</li>
          <li><strong>样式</strong>：Tailwind CSS + CSS Variables</li>
          <li><strong>内容</strong>：Markdown + Gray Matter + Remark</li>
          <li><strong>部署</strong>：Vercel / Docker</li>
          <li><strong>特性</strong>：SSG 静态生成、暗色模式、SEO 优化、标签系统</li>
        </ul>

        <h2>关于作者</h2>
        <p>
          一名后端工程师，喜欢写代码、折腾工具、记录想法。
        </p>

        <h2>联系方式</h2>
        <ul>
          <li>GitHub: <a href="https://github.com" target="_blank" rel="noopener noreferrer">github.com</a></li>
        </ul>

        <hr />

        <p style={{ color: 'var(--color-text-secondary)' }}>
          本博客所有文章均为原创，转载请注明出处。
        </p>
      </div>
    </>
  )
}
