export const SITE = {
  website: "https://killtl.netlify.app/",
  author: "Joker",
  profile: "https://github.com/exgalibas",
  desc: "记录想法、分享经验 — 一个简洁、响应式的个人博客。",
  title: "博客",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 8,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true,
  editPost: {
    enabled: false,
    text: "编辑此页",
    url: "https://github.com/exgalibas/blog/edit/main/",
  },
  dynamicOgImage: false,
  dir: "ltr",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",
} as const;
