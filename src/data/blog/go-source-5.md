---
title: "Golang源码系列--once"
author: "Joker"
pubDatetime: 2019-03-29T20:28:19+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang once的实现源码解析"
---

### 概述
`sync`包中的`once.go`可以在并发情况下保证自定义方法仅仅被执行一次

### 原型
#### Once Struct
```go
type Once struct {
	m sync.Mutex
	done int32
}
```

#### Do
```go
func (o *Once) Do(f func())
```

### 自己玩玩
```go
package main

import (
	"sync"
	"sync/atomic"
	"fmt"
)

type Once struct {
	m sync.Mutex
	done int32
}

func (o *Once) Do(f func()) {
	if atomic.CompareAndSwapInt32(&o.done, 0, 1) {
		f()
	}
}

func main() {
	var once Once
	var wg sync.WaitGroup
	wg.Add(10000)

	for i := 10000; i > 0; i-- {
		go func() {
			defer wg.Done()
			once.Do(func() {
				fmt.Println("once")
			})
		}()
	}

	wg.Wait()
}
```
使用`atomic`包的原语一句话就搞定了，但是`Go`对于`Once`的实现并没有做的这么简单

### Once.Do
#### 源码
```go
func (o *Once) Do(f func()) {
        // 原子载入
	if atomic.LoadUint32(&o.done) == 1 {
		return
	}
	// 上锁
	o.m.Lock()
	defer o.m.Unlock()
        // 避免o.m.Lock()之前o.done被更改
	if o.done == 0 {
                // 原子存储
		defer atomic.StoreUint32(&o.done, 1)
		f()
	}
}
```
麻烦，的确实现的好麻烦，还用到了锁，是不是谷歌大神写这个的时候心情不好~哈哈哈，其实不然，因为仔细看go 包的官方文档里面有这么一句话 `no call to Do returns until the one call to f returns` 翻译过来大致意思就是 - `f`函数没返回之前，不能再调用`Do`，好吧，的确，如果在`f`中调用`Do`，按照上面我自己的实现是不会执行`f`里面的`Do`的，但是使用者却没有感知，这点谷歌大神们可能觉得不太友好吧