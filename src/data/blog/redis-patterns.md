---
title: "Redis 常见使用模式"
author: "Joker"
pubDatetime: 2026-04-04T13:00:00+08:00
draft: false
tags:
  - "技术"
  - "Redis"
description: "Redis 在实际项目中的常见使用场景和最佳实践。"
---

## 缓存

最基础的用途，减轻数据库压力。

```python
def get_user(user_id):
    # 先查缓存
    cached = redis.get(f"user:{user_id}")
    if cached:
        return json.loads(cached)
    
    # 查数据库
    user = db.query_user(user_id)
    
    # 写入缓存，设置过期时间
    redis.setex(f"user:{user_id}", 3600, json.dumps(user))
    return user
```

## 分布式锁

防止并发重复操作。

```python
def acquire_lock(key, timeout=10):
    identifier = str(uuid.uuid4())
    acquired = redis.set(key, identifier, nx=True, ex=timeout)
    return identifier if acquired else None

def release_lock(key, identifier):
    # 用 Lua 脚本保证原子性
    script = """
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
    """
    redis.eval(script, 1, key, identifier)
```

## 排行榜

用 Sorted Set 实现。

```python
# 添加分数
redis.zadd("leaderboard", {"player1": 100, "player2": 200})

# 获取 Top 10
redis.zrevrange("leaderboard", 0, 9, withscores=True)
```

## 限流

滑动窗口限流。

```python
def is_rate_limited(user_id, limit=100, window=60):
    key = f"rate:{user_id}"
    now = time.time()
    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, 0, now - window)
    pipe.zadd(key, {str(now): now})
    pipe.zcard(key)
    pipe.expire(key, window)
    _, _, count, _ = pipe.execute()
    return count > limit
```

## 注意事项

1. **设置过期时间**：避免缓存永不过期
2. **避免大 Key**：单个 Value 不要超过 10KB
3. **使用 Pipeline**：批量操作减少网络开销
4. **监控内存**：配置淘汰策略
