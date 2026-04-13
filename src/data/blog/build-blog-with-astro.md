---
title: "搭建 Astro 博客"
author: "Joker"
pubDatetime: 2026-04-12T15:30:00+08:00
modDatetime: 
featured: false
draft: false
tags:
  - "技术"
  - "Astro"
  - "博客"
description: "记录一下用 Astro 搭建博客的过程和心得。"
---

# 搭建 Astro 博客

最近用 Astro 搭了一个博客，整体体验不错。相比 Next.js，Astro 的零 JS 架构让页面加载飞快。

## 技术选型

- **框架**：Astro 5
- **样式**：Tailwind CSS v4
- **搜索**：Pagefind
- **内容**：Markdown + Frontmatter

## 为什么选 Astro

1. **零 JS 默认**：页面不加载任何 JavaScript，极致性能
2. **内容优先**：天然适合博客和内容站
3. **岛屿架构**：需要交互时才加载 JS
4. **Lightouse 满分**：开箱即用

## 对比 Next.js

| 特性 | Astro | Next.js |
|------|-------|---------|
| 默认 JS | 0KB | ~80KB |
| 构建速度 | 快 | 中等 |
| 交互组件 | 岛屿架构 | React 全量 |
| 学习曲线 | 低 | 中 |
| 适用场景 | 内容站 | 全场景 |

## 总结

如果你只需要一个博客，Astro 是比 Next.js 更好的选择。
