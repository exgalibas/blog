---
title: "Golang源码系列--doc"
author: "Joker"
pubDatetime: 2019-03-28T14:33:06+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang doc的实现源码解析"
---

### 概述
`doc.go`是包`atomic`的提供低级原子操作的实现，对于实现同步算法很有用
包含的原子操作有5种
 - 增或减
 - 比较并交换 (CAS)
 - 交换
 - 载入
 - 存储

支持的类型包含
- int32
- int64
- uint32
- unit64
- uintptr
- unsafe.Pointer

### 增或减
被用于增或减的原子操作都是以`Add`为前缀，并在后面跟具体类型的名称，如
```go
func AddUint32(addr *uint32, delta uint32) (new uint32)
```
#### 示例
```go
package main

import (
	"sync"
	"fmt"
	"sync/atomic"
)

func main() {
	var wg sync.WaitGroup
	var i,j int32 = 0,0

	wg.Add(20)

	for n := 10; n > 0; n-- {
		go func() {
			defer wg.Done()

			for n := 1000; n > 0; n-- {
				i++
			}
		}()

		go func() {
			defer wg.Done()

			for n := 1000; n > 0; n-- {
				atomic.AddInt32(&j, 1)
			}
		}()
	}

	wg.Wait()

	fmt.Println(i, j)
}

// output
9615 10000
```
看到了吧，并发数量高的时候，`AddInt32`可以保证原子性，保证结果正确，而减法的实现是通过加上一个负数
```go
package main

import "sync/atomic"

func main() {
	var i int32 = 5
	atomic.AddInt32(&i, -10)
	print(i)
}

// output 
-5
```
### 交换
原子交换操作，这类函数的名称都以`Swap`为前缀，交换操作直接赋予新值，不管旧值
```go
func SwapInt32(addr *int32, new int32) (old int32)
```
在原子性上等价于
```go
old = *addr
*addr = new
return old
```

### 比较并交换
简称CAS操作(Compare And Swap)，只有被操作的值未曾改变(即与旧值相等)，则进行swap，这类函数名称都以`CompareAndSwap`为前缀
```go
func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
```
在原子性上等价于
```go
if *addr == old {
	*addr = new
	return true
}
return false
```

### 载入
原子读取某个值，即在读取过程中不允许写操作，这类函数名称都以`Load`为前缀
```go
func LoadInt32(addr *int32) (val int32)
```
在原子性上等价于
```go
return *addr
```

### 存储
原子写操作，与载入刚好相反，即在写过程中不允许其他的读/写操作，这类函数名称都以`Store`为前缀
```go
func StoreInt32(addr *int32, val int32)
```
在原子性上等价于
```go
*addr = val
```