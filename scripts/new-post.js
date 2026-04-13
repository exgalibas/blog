#!/usr/bin/env node

/**
 * 新建博客文章
 * 用法：node scripts/new-post.js
 * 
 * 支持自定义：
 *   - 发布时间（可设定未来日期，文章到时间才显示）
 *   - 浏览人数
 *   - 标签
 *   - 摘要
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function question(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve))
}

async function main() {
  console.log('\n📝 新建博客文章\n' + '='.repeat(20) + '\n')

  // 标题
  const title = (await question('文章标题: ')).trim()
  if (!title) {
    console.log('❌ 标题不能为空')
    rl.close()
    return
  }

  // 生成 slug
  const defaultSlug = title
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60)
  
  const slug = (await question(`URL slug [${defaultSlug}]: `)).trim() || defaultSlug

  // 发布时间
  const now = new Date()
  const defaultDate = now.toISOString().replace(/\.\d{3}Z$/, '+08:00')
  const dateInput = (await question(`发布时间 [${defaultDate}]: `)).trim()
  const date = dateInput || defaultDate

  // 是否定时发布（未来时间）
  const publishDate = new Date(date)
  const isScheduled = publishDate > now
  if (isScheduled) {
    console.log(`📅 定时发布：文章将于 ${publishDate.toLocaleString('zh-CN')} 发布`)
  }

  // 浏览人数
  const viewsInput = (await question('初始浏览人数 [0]: ')).trim()
  const views = parseInt(viewsInput) || 0

  // 标签
  const tagsInput = (await question('标签 (逗号分隔) []: ')).trim()
  const tags = tagsInput
    ? tagsInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    : []

  // 摘要
  const excerpt = (await question('摘要 []: ')).trim()

  // 生成 frontmatter
  const frontmatter = [
    '---',
    `title: "${title}"`,
    `date: "${date}"`,
    `views: ${views}`,
  ]

  if (tags.length > 0) {
    frontmatter.push(`tags: [${tags.map((t) => `"${t}"`).join(', ')}]`)
  }

  if (excerpt) {
    frontmatter.push(`excerpt: "${excerpt}"`)
  }

  // 如果是定时发布，添加 published 标记
  if (isScheduled) {
    frontmatter.push('published: false')
  }

  frontmatter.push('---')
  frontmatter.push('')
  frontmatter.push(`# ${title}`)
  frontmatter.push('')
  frontmatter.push('<!-- 在这里写文章内容 -->')
  frontmatter.push('')

  const content = frontmatter.join('\n')

  // 写入文件
  const filePath = path.join(process.cwd(), 'content', 'posts', `${slug}.md`)

  if (fs.existsSync(filePath)) {
    console.log(`\n❌ 文件已存在: content/posts/${slug}.md`)
    rl.close()
    return
  }

  fs.writeFileSync(filePath, content, 'utf8')
  console.log(`\n✅ 文章已创建: content/posts/${slug}.md`)

  if (isScheduled) {
    console.log('💡 文章标记为未发布 (published: false)，到时间后改为 true 或删除该字段')
  }

  console.log('\n运行 npm run dev 预览效果\n')

  rl.close()
}

main()
