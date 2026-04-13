---
title: "Git 常用命令速查"
author: "Joker"
pubDatetime: 2026-04-12T09:00:00+08:00
draft: false
tags:
  - "技术"
  - "Git"
description: "日常开发中最常用的 Git 命令，随时查阅。"
---

## 基础操作

```bash
git init                    # 初始化仓库
git clone <url>             # 克隆远程仓库
git status                  # 查看状态
git add .                   # 暂存所有更改
git commit -m "message"     # 提交
git push                    # 推送
git pull                    # 拉取
```

## 分支管理

```bash
git branch                  # 查看分支
git branch feature-x        # 创建分支
git checkout feature-x      # 切换分支
git checkout -b feature-x   # 创建并切换
git merge feature-x         # 合并分支
git branch -d feature-x     # 删除分支
```

## 撤销与回退

```bash
git checkout -- <file>      # 撤销工作区修改
git reset HEAD <file>       # 取消暂存
git reset --hard HEAD~1     # 回退一个提交
git revert <commit>         # 撤销某个提交
```

## 查看日志

```bash
git log --oneline           # 简洁日志
git log --graph             # 图形化日志
git diff                    # 查看差异
```
