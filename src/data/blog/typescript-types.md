---
title: "TypeScript 类型体操入门"
author: "Joker"
pubDatetime: 2026-04-05T09:00:00+08:00
draft: false
tags:
  - "技术"
  - "TypeScript"
description: "从基础到进阶的 TypeScript 类型编程技巧。"
---

## 为什么学类型体操

类型体操不只是炫技，它能帮你：
- 写出更安全的代码
- 减少运行时错误
- 提升代码提示体验

## 基础工具类型

### Partial & Required

```typescript
type User = {
  name: string;
  age: number;
  email?: string;
};

type OptionalUser = Partial<User>;    // 所有属性变可选
type RequiredUser = Required<User>;   // 所有属性变必填
```

### Pick & Omit

```typescript
type UserBasic = Pick<User, "name" | "age">;  // 只取部分属性
type UserNoAge = Omit<User, "age">;            // 排除部分属性
```

## 条件类型

```typescript
type IsString<T> = T extends string ? "yes" : "no";

type A = IsString<string>;  // "yes"
type B = IsString<number>;  // "no"
```

## 模板字面量类型

```typescript
type EventName = `on${Capitalize<string>}`;
// "onClick" | "onHover" | "onFocus" ...

type CSSProperty = `${string}-${string}`;
// "font-size" | "background-color" ...
```

## 递归类型

```typescript
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

type Config = {
  db: { host: string; port: number };
  cache: { ttl: number };
};

type OptionalConfig = DeepPartial<Config>;
// db?.host?, db?.port?, cache?.ttl? 全部可选
```

## 实战：API 响应类型

```typescript
type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};

type UserResponse = ApiResponse<User>;
// { code: number; message: string; data: User }

type UserListResponse = ApiResponse<User[]>;
// { code: number; message: string; data: User[] }
```

## 推荐资源

- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [Type Challenges](https://github.com/type-challenges/type-challenges)
