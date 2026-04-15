---
title: "Golang源码系列--singleflight"
author: "Joker"
pubDatetime: 2022-07-29T11:11:35+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang singleflight的实现源码解析"
---

### 说明
可以直接看看[go官方扩展包](https://pkg.go.dev/golang.org/x/sync/singleflight)，大致用途就是针对并行的返回相同的多个请求，通过某种方式只真实的请求一次，这种方式其实很简单，就是放行一个请求，然后依赖锁的互斥，使得其他的请求保持等待，直到请求返回，其他请求直接使用返回结果，就避免了重复请求

### 源码
```go
// Copyright 2013 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package singleflight provides a duplicate function call suppression
// mechanism.
package singleflight // import "golang.org/x/sync/singleflight"

import (
	"bytes"
	"errors"
	"fmt"
	"runtime"
	"runtime/debug"
	"sync"
)

// 这个错误意味着实际请求的方法调用了runtime.Goexit进行了退出
// 可用于通知其他等待请求的goroutine
// errGoexit indicates the runtime.Goexit was called in
// the user given function.
var errGoexit = errors.New("runtime.Goexit was called")

// 包装panic的错误，里面有错误信息和调用栈
// A panicError is an arbitrary value recovered from a panic
// with the stack trace during the execution of given function.
type panicError struct {
	value interface{}
	stack []byte
}

// 实现error接口
// Error implements error interface.
func (p *panicError) Error() string {
	return fmt.Sprintf("%v\n\n%s", p.value, p.stack)
}

// new一个，其实就是把调用栈加进去
func newPanicError(v interface{}) error {
	stack := debug.Stack()

	// The first line of the stack trace is of the form "goroutine N [status]:"
	// but by the time the panic reaches Do the goroutine may no longer exist
	// and its status will have changed. Trim out the misleading line.
	if line := bytes.IndexByte(stack[:], '\n'); line >= 0 {
		stack = stack[line+1:]
	}
	return &panicError{value: v, stack: stack}
}

// call其实就是代表一个请求
// call is an in-flight or completed singleflight.Do call
type call struct {
	// 这个用来做并行请求间的互斥和同步
	// wg.wait可以用来做互斥，wg.done可以用来做同步
	wg sync.WaitGroup

	// 请求返回
	// These fields are written once before the WaitGroup is done
	// and are only read after the WaitGroup is done.
	val interface{}
	// 请求错误
	err error

	// 标记请求是否从集合中删除
	// forgotten indicates whether Forget was called with this call's key
	// while the call was still in flight.
	forgotten bool

	// dups标记有多少个其他的请求共享结果
	// These fields are read and written with the singleflight
	// mutex held before the WaitGroup is done, and are read but
	// not written after the WaitGroup is done.
	dups  int
	// chans标记有多少个请求通过channel共享结果
	chans []chan<- Result
}

// calls的集合
// 其实很简单，就是一把锁和一个map，如我们开篇想的一样
// Group represents a class of work and forms a namespace in
// which units of work can be executed with duplicate suppression.
type Group struct {
	mu sync.Mutex       // protects m
	m  map[string]*call // lazily initialized
}

// Result主要是为了方便把请求的返回结果包装好丢到channel中
// Result holds the results of Do, so they can be passed
// on a channel.
type Result struct {
	Val    interface{}
	Err    error
	Shared bool
}

// Do方法通过key来找到集合g中是否有相同key的进行中的请求
// 如果没有则会调用fn来执行请求，该方法会直接返回请求的返回、错误以及是否被其他请求共享
// Do executes and returns the results of the given function, making
// sure that only one execution is in-flight for a given key at a
// time. If a duplicate comes in, the duplicate caller waits for the
// original to complete and receives the same results.
// The return value shared indicates whether v was given to multiple callers.
func (g *Group) Do(key string, fn func() (interface{}, error)) (v interface{}, err error, shared bool) {
	// 上来就一把锁，因为后面会立即操作g.m
	// go的map是不支持并发的
	g.mu.Lock()
	// 这里是一个延迟初始化，也就是我们使用的时候可以不用管Group.m
	if g.m == nil {
		g.m = make(map[string]*call)
	}
	// 先判断g.m中是否有key对应的call
	// 如果有，说明有相同的请求在执行，那么等待结果就好了
	if c, ok := g.m[key]; ok {
		// 有了新的等待的请求，dups计数自增1
		c.dups++
		// 到这里就可以解锁了
		// if之前解锁可以吗？想啥呢，在读map呢
		// c.dups++之前解锁可以吗？想啥呢，除非dups++换成atomic.Add之类的原子操作
		// 总没人想问为什么不在wg.Wait()之后解锁吧，出门右转啊
		g.mu.Unlock()
		c.wg.Wait()

		// 能走到这里，说明fn执行完毕了
		// 判断是不是panic以及是否调用了runtime.Goexit()主动退出goroutine
		// panicError和errGoexit两种错误类型会在doCall方法里面处理
		if e, ok := c.err.(*panicError); ok {
			// 透传panic
			panic(e)
		} else if c.err == errGoexit {
			// 透传Goexit
			// 意思就是某个请求进行了Goexit，那么其他等待该请求结果的其他请求也会进行Goexit
			// 注意runtime.Goexit()虽然看起来效果跟panic差不多(立即中断执行并退出，退出之前还能执行注册过的defer)，但是不会被recover，也只会退出当前的goroutine，不影响其他的
			runtime.Goexit()
		}
		// 返回请求结果
		return c.val, c.err, true
	}

	// 如果没有，那就new一个call并执行返回结果
	c := new(call)
	// wg添加一个等待，如果没有add就wait是会panic的
	c.wg.Add(1)
	// 加入到集合中
	g.m[key] = c
	// 这里的解锁一定要放到操作g.m之后，因为虽然相同的多个并行请求能走到这里的只有一个
	// 但是不同请求也会共享g.m，所以对g.m的操作务必保证全局有序
	g.mu.Unlock()
	// 调用doCall来执行fn并处理某些特殊情况
	g.doCall(c, key, fn)
	// 返回结果，结果都存在c中，这样能共享给等待请求结果的其他请求
	return c.val, c.err, c.dups > 0
}

// DoChan方法跟Do差不多，只是有些许不同，比如返回的是一个只读的channel而不是请求结果
// 不过这个channel也是用来传递请求结果的
// DoChan is like Do but returns a channel that will receive the
// results when they are ready.
//
// The returned channel will not be closed.
func (g *Group) DoChan(key string, fn func() (interface{}, error)) <-chan Result {
	// 无非就是比Do方法多初始化了个channel
	ch := make(chan Result, 1)
	g.mu.Lock()
	if g.m == nil {
		g.m = make(map[string]*call)
	}
	if c, ok := g.m[key]; ok {
		c.dups++
		// 把初始化好的channel加入到c的共享channel集合中
		c.chans = append(c.chans, ch)
		// 注意，这里的解锁必须在操作了c.chans之后，否则可能导致chans中的channel一直拿不到结果
		// 因为doCall方法里delete(g.m, key)的操作也是获取到g.mu.Lock()之后执行的
		// 这样两个锁之间是互斥的，保证了g.m的对key的删除和读取是互斥的
		// 而且doCall中删除key的锁也会锁住遍历c.chans并放入result
		// 所以获取g.m[key]的锁也需要锁住append(c.chans, ch)才能保证加入channel集合和遍历赋值channel是先后序的
		g.mu.Unlock()
		// 这里就不用跟Do方法一样使用wg.Wait()来等待了，因为返回的是channel，直接通过读取channel阻塞等待就好了
		return ch
	}
	// 如果集合中没有key对应的请求就放行一个
	c := &call{chans: []chan<- Result{ch}}
	// 这里Add的原因是考虑后续可能会使用Do方法来执行相同key的请求，同时也是为了兼容doCall的wg.Done()避免panic
	// 因为不管是Do方法还是DoChan方法都是调用doCall，都会把结果写入到call中
	// 不同的是DoChan返回的是channel，把call中的结果冗余了一份到Result中，而Do则是直接返回结果
	// 所以即使先使用DoChan调用请求，再使用Do调用相同的请求，也是可以复用DoChan的结果
	// 同理先使用Do再使用DoChan也是一样的，无非就是make一个channel丢到c.chans里面
	c.wg.Add(1)
	g.m[key] = c
	g.mu.Unlock()

	// 因为返回的是channel不需要等待，直接go执行更快
	go g.doCall(c, key, fn)

	return ch
}

// doCall是真正执行fn的方法，同时也兼容了Do和DoChan，返回结果的同时会将结果同步一份到c.chans中(如果需要)
// doCall handles the single call for a key.
func (g *Group) doCall(c *call, key string, fn func() (interface{}, error)) {
	// 标记正常返回，非panic，非runtime.Goexit
	normalReturn := false
	// 是否需要recover，即是否有panic
	// 通过这两个标签，就可以过滤出runtime.Goexit
	recovered := false

	// 这是一个典型的双defer操作来区分出panic和runtime.Goexit
	// 主要吧是因为这个runtime.Goexit没法被recover，但是还好能触发defer
	// 建议先看下面的defer
	// use double-defer to distinguish panic from runtime.Goexit
	// more details see https://golang.org/cl/134395
	defer func() {
		// 第二个defer处理完之后
		// 如果即不是正常返回又不是panic，那就是runtime.Goexit了
		// the given function invoked runtime.Goexit
		if !normalReturn && !recovered {
			//设置对应错误
			c.err = errGoexit
		}

		// 到这里就可以唤醒wg.Wait了，因为返回结果收集到了
		// 对应的error信息也设置完了
		c.wg.Done()
		// 下面是操作g.m了，需要lock
		g.mu.Lock()
		// defer嵌套defer
		defer g.mu.Unlock()
		// 判断key是否已经从g.m中删除，因为可以通过Forget方法主动删除
		if !c.forgotten {
			delete(g.m, key)
		}

		// 其他等待的请求会在Do和DoChan中处理错误进行panic和Goexit
		// 当前请求需要在当前goroutine中处理错误
		if e, ok := c.err.(*panicError); ok {
			// In order to prevent the waiting channels from being blocked forever,
			// needs to ensure that this panic cannot be recovered.
			// 如果有监听结果的channel，为了防止panic被上层recover导致goroutine泄露
			// 直接使用go panic(e)来终止掉进程，这个感觉够狠的，难道不能遍历下c.chans然后close掉吗？
			if len(c.chans) > 0 {
				go panic(e)
				// 这里会阻塞，主要是为了panic的时候能保留本次调用的现场
				select {} // Keep this goroutine around so that it will appear in the crash dump.
			} else {
				panic(e)
			}
		} else if c.err == errGoexit {
			// 因为是当前goroutine，本来就执行完了，没啥可做的，符合Goexit
			// 不过有个问题，如果是调用Do方法就问题不大，但是如果调用DoChan方法可能会导致goroutine泄露，具体可以看后面的例子
			// Already in the process of goexit, no need to call again
		} else {
			// Normal return
			// 通知c.chans的每个嗷嗷待哺的channel
			for _, ch := range c.chans {
				ch <- Result{c.val, c.err, c.dups > 0}
			}
		}
	}()

	// 包到一个方法中，这样如果panic了可以通过recover恢复执行
	// runtime.Goexit则会中断到第一个defer
	// 基于这个差别就可以通过操作标志变量来区分啦
	func() {
		defer func() {
			// 如果没有正常返回，则尝试recover，panic会被recover恢复，并new一个panic的error
			if !normalReturn {
				// Ideally, we would wait to take a stack trace until we've determined
				// whether this is a panic or a runtime.Goexit.
				//
				// Unfortunately, the only way we can distinguish the two is to see
				// whether the recover stopped the goroutine from terminating, and by
				// the time we know that, the part of the stack trace relevant to the
				// panic has been discarded.
				if r := recover(); r != nil {
					c.err = newPanicError(r)
				}
			}
		}()

		// 执行请求
		c.val, c.err = fn()
		// 设置正常返回
		normalReturn = true
	}()

	// 能走到这里，要么正常返回，要么panic
	if !normalReturn {
		// 如果不是正常返回，那么就是panic，设置恢复标志
		recovered = true
	}
}
// 这里抛出一个疑问，难道一个defer不能区分panic和Goexit吗，答案是不可以
// 如果是一个defer，通过recover是可以抓住panic，但是Goexit呢，要知道Goexit后fn的返回是没有err，val也应该是nil
// 除非fn中处理了Goexit返回了err，但是这是不合理的，因为你不应该强制使用者了解底层的处理细节，从而遵守约定


// 这个比较简单，就是手动删掉g.m中的某个key
// Forget tells the singleflight to forget about a key.  Future calls
// to Do for this key will call the function rather than waiting for
// an earlier call to complete.
func (g *Group) Forget(key string) {
	g.mu.Lock()
	if c, ok := g.m[key]; ok {
		c.forgotten = true
	}
	delete(g.m, key)
	g.mu.Unlock()
}
```

### Bad Case
```go
func main() {
	g := &singleflight.Group{}
	f := func() (interface{}, error) {
		time.Sleep(time.Second * 2)
		// panic("test")  如果是panic，会终止掉程序
		// runtime.Goexit() 如果是Goexit，会导致第二个goroutine一直在for循环中等待
		return nil, nil
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer func() {
			if e := recover(); e != nil {
				fmt.Println("recover")
			}
			wg.Done()
		}()
		v, e, s := g.Do("joker", f)
		fmt.Println(v, e, s)
	}()
	time.Sleep(time.Second)
	go func() {
		defer wg.Done()
		ch := g.DoChan("joker", f)
		for {
			select {
			case <-ch:
				fmt.Println("get success")
				break
			case <-time.After(time.Second):
				fmt.Println("1 second wait")
			}
		}
	}()

	wg.Wait()
}
```
这是一个比较典型的例子，可以先试试panic，对于panic，Do和DoChan都有对应处理，再试试Goexit就会发现，第二个goroutine泄露了会一直循环下去，原因是使用了DoChan，个人理解没有将Goexit传递到所有等待请求结果的其他请求中

### 总结
 - `go panic`的效果
 - 双`defer`的骚操作
 - 使用锁来进行互斥，以及最小粒度的保护临界区
 - `sync.WaitGroup`的互斥和同步用法
使用Do方法，如果fn执行时间比较长，在并发度比较高的情况下会导致比较多的goroutine阻塞，可以使用DoChan，在等待channel返回的时候通过select和time.After来控制超时，但是切记，如果使用了DoChan，一定要避免死等待