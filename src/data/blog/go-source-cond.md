---
title: "Golang源码系列--cond"
author: "Joker"
pubDatetime: 2019-04-01T15:08:01+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang cond的实现源码解析"
---

### 概述
`cond.go`通过条件变量共享实现`goroutine`之间通信，并非开箱即用，需要在代码中显示锁定和解锁

### Struct
```go
type Cond struct {
	noCopy noCopy  // 拥有一个Lock方法，使得Cond对象在进行go vet扫描的时候，能够被检测到是否被复制
	L Locker  // 锁
	notify  notifyList // 待唤醒goroutine队列
	checker copyChecker  // 复制检查，用于保存自身地址
}
```

### NewCond
```go
func NewCond(l Locker) *Cond {
	return &Cond{L: l}  // 初始化并返回cond
}
```

### check
```go
func (c *copyChecker) check() {
    // 先检查c的值是否等于地址
    // 首次检查将c的地址复制到值，通过原子操作和旧值old=0保证是首次检查
    // 赋值后再检查一遍c的值是否等于地址
	if uintptr(*c) != uintptr(unsafe.Pointer(c)) &&
		!atomic.CompareAndSwapUintptr((*uintptr)(c), 0, uintptr(unsafe.Pointer(c))) &&
		uintptr(*c) != uintptr(unsafe.Pointer(c)) {
		panic("sync.Cond is copied")
	}
}
```
`check`主要通过类型为`uintptr`的`cond.checker`来标志是否被复制，因为`uintptr`足够大到保存地址值，所以通过首次将地址保存到值，这样如果被复制，那么只会复制值，地址会变，一旦值和地址不一样就是被复制了

### Wait
```go
func (c *Cond) Wait() {
	c.checker.check()   // 检查是否被复制
	t := runtime_notifyListAdd(&c.notify)  // 将当前go加入等待队列并返回加入前的队列数
	c.L.Unlock()  // 解锁，因为后面要wait了
	runtime_notifyListWait(&c.notify, t)  // 阻塞等待
	c.L.Lock()  // 唤醒后重新获得锁
}
```
源码包中有个使用示例
```go
    c.L.Lock()  // 锁住
    for !condition() {  // 循环判断条件变量
        c.Wait() // 不符合继续等待
    }
    ... make use of condition ... // 符合继续操作
    c.L.Unlock() // 解锁
```

### Signal
```go
func (c *Cond) Signal() {
	c.checker.check()  // 检查是否复制
	runtime_notifyListNotifyOne(&c.notify)  // 唤醒一个go
}
```
`Signal`会以`FIFO`的方式唤醒一个等待队列中的go

### Broadcast
```go
func (c *Cond) Broadcast() {
	c.checker.check()  // 检查是否复制 
	runtime_notifyListNotifyAll(&c.notify)  // 广播唤醒所有等待中的go
} 
```

### 实例
```go
package main

import (
	"sync"
	"fmt"
	"time"
)

var (
	condition = false
	wg = sync.WaitGroup{}
	cond = sync.NewCond(&sync.Mutex{})
)

func main() {
	wg.Add(11)

	for i := 10; i > 0; i-- {
		go func(i int) {
			defer wg.Done()
			cond.L.Lock()
			for !condition {
				fmt.Printf("%d condition not true\n", i)
				cond.Wait()
			}
			fmt.Printf("%d condition true\n", i)
			cond.L.Unlock()
		}(i)
	}

	time.Sleep(time.Second)

	go func() {
		defer wg.Done()
		cond.Broadcast()
		time.Sleep(time.Second)
		condition = true
		cond.Signal()
		time.Sleep(time.Second)
		cond.Broadcast()
	}()

	wg.Wait()
}
```

### 总结
`cond`主要用于并发场景且满足某个条件，而且是通过共享变量去实现通信，这不是跟go的原则(通过通信去实现共享内存)有悖吗
