---
title: "Docker 入门笔记"
author: "Joker"
pubDatetime: 2026-04-11T14:00:00+08:00
draft: false
tags:
  - "技术"
  - "Docker"
description: "Docker 基础概念和常用命令整理。"
---

## 什么是 Docker

Docker 是一个容器化平台，把应用和依赖打包到一个可移植的容器中运行。

## 核心概念

- **镜像 (Image)**：只读模板，包含运行应用所需的一切
- **容器 (Container)**：镜像的运行实例
- **Dockerfile**：构建镜像的脚本
- **Docker Compose**：多容器编排工具

## 常用命令

```bash
docker build -t myapp .          # 构建镜像
docker run -p 3000:3000 myapp    # 运行容器
docker ps                        # 查看运行中的容器
docker stop <id>                 # 停止容器
docker logs <id>                 # 查看日志
docker exec -it <id> /bin/sh     # 进入容器
```

## Dockerfile 示例

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## 建议

- 优先用 Alpine 基础镜像，体积小
- 多阶段构建减小最终镜像大小
- 不要在镜像中存敏感信息
