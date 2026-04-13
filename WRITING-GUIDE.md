# 📝 博客写作指南

## 快速开始

在 `src/data/blog/` 目录下新建 `.md` 文件即可发布文章。

---

## 文章模板

```markdown
---
title: "文章标题"
author: "Joker"
pubDatetime: 2026-04-14T10:00:00+08:00
modDatetime:
featured: false
draft: false
tags:
  - "标签1"
  - "标签2"
ogImage: ""
description: "文章摘要，会显示在文章列表和 SEO 中"
---

在这里写正文...
```

---

## Frontmatter 字段说明

| 字段 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `title` | ✅ | 文章标题 | `"我的第一篇博客"` |
| `author` | ❌ | 作者，默认取 config.ts 中的值 | `"Joker"` |
| `pubDatetime` | ✅ | 发布时间 | `2026-04-14T10:00:00+08:00` |
| `modDatetime` | ❌ | 修改时间，有值会显示"更新于" | `2026-04-15T20:00:00+08:00` |
| `featured` | ❌ | 是否精选（显示在首页精选区） | `true` / `false` |
| `draft` | ❌ | 是否草稿（true 不会显示） | `true` / `false` |
| `tags` | ✅ | 标签列表，支持中文 | `["技术", "Vue"]` |
| `description` | ✅ | 文章摘要 | `"这是一篇关于...的文章"` |
| `ogImage` | ❌ | 分享卡片图片 | `"/images/my-cover.png"` |
| `canonicalURL` | ❌ | 原文链接（转载时用） | `"https://example.com/post"` |
| `timezone` | ❌ | 时区覆盖 | `"Asia/Tokyo"` |
| `hideEditPost` | ❌ | 隐藏"编辑此页"按钮 | `true` |

---

## 自定义发布时间

发布时间完全由 `pubDatetime` 控制，你可以：

### 立即发布
```yaml
pubDatetime: 2026-04-14T10:00:00+08:00
draft: false
```

### 定时发布（草稿模式）
先设为草稿，到时间后改为 `draft: false`：
```yaml
pubDatetime: 2026-05-01T10:00:00+08:00
draft: true   # ← 到时间后改为 false 或删掉这行
```

### 补发旧文章
直接写过去的日期即可：
```yaml
pubDatetime: 2026-01-15T08:00:00+08:00
```

---

## 图片处理

### 方式一：本地图片（推荐）

将图片放到 `public/images/` 目录下，然后在 Markdown 中引用：

```
public/
  images/
    my-post/
      screenshot.png
      diagram.jpg
```

文章中写：

```markdown
![截图](/images/my-post/screenshot.png)
![架构图](/images/my-post/diagram.jpg)
```

> 💡 `/images/...` 路径对应 `public/images/...` 目录，构建时会被原样复制。

### 方式二：网络图片

直接使用完整 URL：

```markdown
![示例图片](https://example.com/photo.jpg)
```

### 方式三：Frontmatter 封面图

```yaml
ogImage: "/images/my-post/cover.png"
```

封面图会显示在社交分享卡片中（微信/Twitter/Slack 等）。

### 图片建议

- **格式**：优先用 WebP（体积小），PNG 做截图，JPG 做照片
- **尺寸**：文章内图片宽度不要超过 1200px
- **命名**：用英文+短横线，如 `vue-lifecycle.png`
- **目录**：每篇文章建议建一个子目录，如 `public/images/my-post/`

---

## Markdown 写作技巧

### 代码块

支持语法高亮，指定语言即可：

````markdown
```python
def hello():
    print("Hello, World!")
```
````

带文件名的代码块：

````markdown
```js title="utils.js"
function add(a, b) {
  return a + b;
}
```
````

高亮指定行：

````markdown
```js {2-3}
function hello() {
  console.log("这行会高亮");  // ← 高亮
  console.log("这行也会");    // ← 高亮
}
```
````

### 引用

```markdown
> 这是一段引用文字
```

### 表格

```markdown
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| 数据 | 数据 | 数据 |
```

### 折叠内容

```markdown
:::collapse 点击展开
这里是折叠的内容，默认收起。
:::
```

### 目录

在文章中需要显示目录的位置加一行：

```markdown
## 目录
```

会自动根据标题生成目录。

### 链接

```markdown
[链接文字](https://example.com)
[另一篇文章](/posts/my-other-post)
```

---

## 文章示例（完整）

```markdown
---
title: "Vue3 组合式 API 实践"
author: "Joker"
pubDatetime: 2026-04-14T15:30:00+08:00
featured: true
draft: false
tags:
  - "技术"
  - "Vue"
  - "前端"
description: "分享 Vue3 组合式 API 的实战经验，包含常见模式和踩坑记录。"
---

## 目录

## 前言

最近在项目中大量使用了 Vue3 的组合式 API，整理一些心得。

![项目截图](/images/vue3-practice/screenshot.png)

## 基础用法

```typescript
import { ref, computed } from 'vue'

const count = ref(0)
const doubled = computed(() => count.value * 2)
```

## 常见模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| ref | 基础响应式 | 简单值 |
| reactive | 对象响应式 | 复杂对象 |
| computed | 计算属性 | 派生状态 |

> 💡 提示：优先使用 ref，它是更底层的响应式原语。

## 总结

组合式 API 让逻辑复用变得更自然，推荐尝试。
```

---

## 常见问题

### Q: 文章不显示？
检查 `draft` 是否为 `true`，草稿文章不会出现在列表中。

### Q: 标签页面找不到文章？
标签是精确匹配的，确保 frontmatter 中 `tags` 的值和标签页 URL 中的名称一致。

### Q: 搜索搜不到？
搜索功能需要先 `npm run build` 生成索引，开发模式下搜索不可用。

### Q: 图片显示不出来？
1. 确认图片放在 `public/images/` 下
2. 确认路径以 `/` 开头：`![alt](/images/xxx.png)`
3. 确认文件名没有中文或空格

### Q: 如何修改博客基本信息？
编辑 `src/config.ts`，可以修改标题、描述、作者、时区等。

### Q: 如何修改社交链接？
编辑 `src/constants.ts`，增删 `SOCIALS` 数组中的项目。

---

## 目录结构

```
blog-v2/
├── public/
│   ├── images/          ← 📷 图片放这里
│   │   └── my-post/
│   │       ├── pic1.png
│   │       └── pic2.jpg
│   └── favicon.svg
├── src/
│   ├── data/
│   │   └── blog/        ← 📝 文章放这里（.md 文件）
│   │       ├── hello-world.md
│   │       └── my-new-post.md
│   ├── config.ts        ← ⚙️ 博客配置
│   ├── constants.ts     ← 🔗 社交链接
│   └── pages/
│       └── about.md     ← 👋 关于页面
└── WRITING-GUIDE.md     ← 📖 本文件
```
