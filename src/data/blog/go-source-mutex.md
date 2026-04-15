---
title: "Golang源码系列--mutex"
author: "Joker"
pubDatetime: 2019-03-29T18:22:56+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang mutex的实现源码解析"
---

### 概述
`mutex.go`是golang中针对互斥锁的实现，内部仅提供两个方法，分别是`Lock()`和`Unlock`，同时定义了几个常量和一个`Mutex`结构，如下
```go
type Mutex struct {
	state int32     // 互斥锁上锁状态枚举值如下所示
	sema  uint32    // 信号量，向处于Gwaitting的G发送信号
}

const (
	mutexLocked = 1 << iota // 1 互斥锁是锁定的
	mutexWoken              // 2 唤醒锁
	mutexWaiterShift = iota // 2 统计阻塞在这个互斥锁上的goroutine数目需要移位的数值
)
```
如果对`Mutex`进行复制，可能会导致锁失效，因为内部都是值复制，相当于复制了一把新锁，`mutexLocked`标识`Mutex.state`的最低位的值，`mutexWoken`标识`Mutex.state`的倒数第二低位的值，`mutexWaiterShift`标识阻塞等待锁的`goroutine`的数量(计算方式为 `Mutex.state >> mutexWaiterShift`)，所以可以用于表示阻塞数量的二进制位数为`32-2=30`

### 前置知识
 - `doc.go`中的原子操作，参见上一篇博文doc.go
 - `runtime_canSpin` golang中实现的自旋(类似发动机空转)，在`Mutex`中主要用于短暂占用cpu时间避免当前`goroutine`进入睡眠状态(因为大量的Mutex使用场景都是在小片段代码，锁和解锁的操作间隔很短，新的`goroutine`可以自旋一段时间尝试获取锁)
 - `runtime_doSpin ` 让CPU pause一段时间，配合`runtime_canSpin`使用
 - `runtime_SemacquireMutex` 睡眠
 - `runtime_Semrelease` 唤醒

### 小实现
基于锁的原理，我们可以自己通过原子操作实现一把非常简单的锁，如下代码
```go
package main

import (
	"sync/atomic"
	"time"
	"sync"
)

type Mutex struct {
	state int32  // 锁状态 0未锁/1已锁
}

func (m *Mutex) Lock() {
	for {
                // 原子cas操作
		if atomic.CompareAndSwapInt32(&m.state, 0, 1) {
			break
		}
                // 睡眠一秒
		time.Sleep(time.Second)
	}
}

func (m *Mutex) Unlock() {
        // 重复解锁或者未锁状态解锁报异常
	if !atomic.CompareAndSwapInt32(&m.state, 1, 0) {
		panic("lock state error")
	}
}

func main() {
	var wg sync.WaitGroup
	var mu Mutex
	wg.Add(100)

	f := func(index int) {
		defer wg.Done()
		mu.Lock()
		time.Sleep(time.Microsecond * 10)
		mu.Unlock()
	}

	for i := 100; i > 0; i-- {
		go f(i)
	}

	wg.Wait()
}
```
上面这个实现是十分简陋的，后面可以看到google的大神们是怎么玩出花来的

### Lock
#### 原型
```go
func (m *Mutex) Lock()
```

#### 源码
```go
func (m *Mutex) Lock() {
        // 先使用CAS尝试获取锁
        // 上面我们的简版实现就用到了 CompareAndSwapInt32
	if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        // 这里不需要管它，是用于竞争检测的
        // 下同 
		if race.Enabled {
			race.Acquire(unsafe.Pointer(m))
		}
        // 成功获取返回
		return
	}

	awoke := false  // 唤醒标记
	iter := 0       // 自旋计数器
	for {
		old := m.state // 获取当前锁状态
        // 将当前状态最后一位指定1
        // 没拿到就是锁住了，拿到了也会锁住，反正都是锁住
		new := old | mutexLocked  
		if old&mutexLocked != 0 {  // 如果被锁住了
			if runtime_canSpin(iter) {  // 检查是否可以进入自旋锁
				if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
					atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) { 
					awoke = true  // 设置唤醒标记为true，主要配合Unlock，自旋的时候避免unlock唤醒新的协程，减少锁竞争
				} 
				runtime_doSpin()  // 等一会 
				iter++
				continue
			}
			new = old + 1<<mutexWaiterShift  // 没有获取到锁，当前goroutine进入等待队列
		}
		if awoke {
            // 检查状态是否一致，是否真的被Unlock唤醒
			if new&mutexWoken == 0 {
				throw("sync: inconsistent mutex state")
			}
                        //清除标记
			new &^= mutexWoken
		}
        // 更新状态
		if atomic.CompareAndSwapInt32(&m.state, old, new) {
            // old锁是未锁定，new锁前面已经设置成锁定并通过原子操作更新成功，那就是当前goroutine获取到锁了
			if old&mutexLocked == 0 {
				break
			}
                         
            // 锁请求失败,进入休眠状态,等待信号唤醒后重新开始循环
			runtime_SemacquireMutex(&m.sema)
            // 被唤醒，设置唤醒标志
			awoke = true
            // 清零自旋次数 
			iter = 0
		}
	}

	if race.Enabled {
		race.Acquire(unsafe.Pointer(m))
	}
}
```
总结下上面一些有意思的点
 - 使用自旋
 - 针对写锁状态，务必使用原子操作
 - 使用锁状态的old版本进行判断，使用new版本进行更新，更新过程务必保证当前锁状态=old且更新过程必须是原子操作

### Unlock
#### 原型
```go
func (m *Mutex) Unlock()
```

#### 源码
```go
func (m *Mutex) Unlock() {
	if race.Enabled {
		_ = m.state
		race.Release(unsafe.Pointer(m))
	}

	// 移除标记
	new := atomic.AddInt32(&m.state, -mutexLocked)
       // 判断是否重复unlock
       // 这里先原子更改再判断更改后的值
       // 比先判断后更改更安全且更简单，不信你可以试试，注意考虑并发场景
	if (new+mutexLocked)&mutexLocked == 0 {
		throw("sync: unlock of unlocked mutex")
	}

	old := new
	for {
		//当休眠队列内的等待计数为0或者已有goroutine获得锁或者已有运行中的获取锁goroutine
		if old>>mutexWaiterShift == 0 || old&(mutexLocked|mutexWoken) != 0 {
			return
		}
		// 没有goroutine主动来获取锁
        // 好吧，只有我来唤醒睡眠中的来取锁了
        // 等待队列数量减1，设置唤醒标志位
		new = (old - 1<<mutexWaiterShift) | mutexWoken
		if atomic.CompareAndSwapInt32(&m.state, old, new) {
                        // 发送释放信号
			runtime_Semrelease(&m.sema)
			return
		}
        // 上面都没命中，循环搞
		old = m.state
	}
}
```
Unlock相对来说更简单点