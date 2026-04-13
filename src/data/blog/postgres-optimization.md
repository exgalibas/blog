---
title: "PostgreSQL 查询优化笔记"
author: "Joker"
pubDatetime: 2026-04-07T10:00:00+08:00
draft: false
tags:
  - "技术"
  - "数据库"
  - "PostgreSQL"
description: "记录 PostgreSQL 查询优化的实践经验，包含 EXPLAIN 分析和索引策略。"
---

## 为什么查询会慢

常见原因：
1. 全表扫描
2. 缺少索引
3. 索引未被使用
4. 连接查询效率低
5. 数据量过大未分区

## EXPLAIN ANALYZE

```sql
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'test@example.com';
```

关注几个关键指标：
- **Seq Scan**：全表扫描，通常需要优化
- **Index Scan**：索引扫描，正常
- **cost**：预估成本
- **actual time**：实际执行时间
- **rows**：实际返回行数

## 索引优化

### 创建合适的索引

```sql
-- 单列索引
CREATE INDEX idx_users_email ON users(email);

-- 复合索引（注意列顺序）
CREATE INDEX idx_orders_user_date ON orders(user_id, created_at);

-- 部分索引
CREATE INDEX idx_active_users ON users(email) WHERE active = true;
```

### 索引列顺序原则

1. 等值条件列在前
2. 范围条件列在后
3. 排序列跟在后面

```sql
-- 好：WHERE user_id = 1 AND created_at > '2026-01-01' ORDER BY created_at
CREATE INDEX idx_good ON orders(user_id, created_at);

-- 差：范围条件在前
CREATE INDEX idx_bad ON orders(created_at, user_id);
```

## 常见优化技巧

### 避免 SELECT *

```sql
-- 差
SELECT * FROM users;

-- 好
SELECT id, name, email FROM users;
```

### 批量操作代替循环

```sql
-- 差：循环单条插入
INSERT INTO logs (...) VALUES (...);

-- 好：批量插入
INSERT INTO logs (...) VALUES (...), (...), (...);
```

### 用 EXISTS 替代 IN

```sql
-- 当子查询结果集大时
SELECT * FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

## 监控慢查询

```sql
-- 查看当前慢查询
SELECT pid, now() - pg_stat_activity.query_start AS duration,
       query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';
```
