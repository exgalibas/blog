---
title: "Golang源码系列--WaitGroup"
author: "Joker"
pubDatetime: 2022-02-14T23:40:32+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang WaitGroup的实现源码解析"
---

### 概述
`WaitGroup`主要用于等待多个`goroutines`执行完，具体怎么用这种基操就不说了

### 结构
```go
// WaitGroup结构体
type WaitGroup struct {
	// noCopy，同字面意思，就是不允许copy
	// go中禁止copy的方法就是在目标结构体中声明一个结构体noCopy的变量，这样go vet就能检测出来
	// 详见 https://github.com/golang/go/issues/8005#issuecomment-190753527
	noCopy noCopy

	// 64-bit value: high 32 bits are counter, low 32 bits are waiter count.
	// 64-bit atomic operations require 64-bit alignment, but 32-bit
	// compilers do not ensure it. So we allocate 12 bytes and then use
	// the aligned 8 bytes in them as state, and the other 4 as storage
	// for the sema.
	// 包含3个uint32的数组，这三个uint32分别表示goroutine计数(对应Add和Done操作)、等待计数(对应Wait操作)和信号量，信号量是用来唤醒因调用wait而睡眠等待的goroutine
	// 具体state1中哪个uint32表示上述三个变量，这个得在运行时计算得出
	// 主要原因是在Add中会用到原子操作atomic.AddUint64，该方法要求对齐系数是8，关于内存对齐，可参考 https://gfw.go101.org/article/memory-layout.html
	// 所以当运行在32位机器的时候，由于默认对齐系数是4，所以state1的地址可能是8的倍数也可能不是8的倍数，当不是8的倍数的时候，state1[0]表示信号量，state[1]和state[2]分别表示goroutine计数和等待计数，这样state[1]的地址就肯定是8的倍数
	// 这么做的好处是无论是32位机器还是64位机器，state1始终只占用12个字节，不会为了内存对齐而浪费内存空间
	state1 [3]uint32
}

// state returns pointers to the state and sema fields stored within wg.state1.
// 动态获取goroutine计数、等待计数和信号量，下面用c、w和p表示
func (wg *WaitGroup) state() (statep *uint64, semap *uint32) {
	// 如果state1的地址是8的倍数
	if uintptr(unsafe.Pointer(&wg.state1))%8 == 0 {
		// state1[0]和state1[1]分别是c和w，state1[2]是p
		// 这是这里c和w统一按照一个uint64返回，分别占据高32位和低32位
		return (*uint64)(unsafe.Pointer(&wg.state1)), &wg.state1[2]
	} else {
		// 否则state1[1]和state1[2]分别是c和w，state1[0]是p
		return (*uint64)(unsafe.Pointer(&wg.state1[1])), &wg.state1[0]
	}
}
```

### Add和Done
```go
// 添加goroutine计数，注意delta可正可负
// 当delta为负数时，对应Done操作
func (wg *WaitGroup) Add(delta int) {
	// 获取c、w和p
	statep, semap := wg.state()
	// 竞态检测
	if race.Enabled {
		_ = *statep // trigger nil deref early
		if delta < 0 {
			// Synchronize decrements with Wait.
			race.ReleaseMerge(unsafe.Pointer(wg))
		}
		race.Disable()
		defer race.Enable()
	}
	// 还记得上面说的吧，这里高32位是c，所以需要将delta右移32位加和
	// 这里用到了原子操作，也就是并发安全的
	state := atomic.AddUint64(statep, uint64(delta)<<32)
	// 高32位是c
	v := int32(state >> 32)
	// 低32位是w
	w := uint32(state)
	// 竞态检测
	if race.Enabled && delta > 0 && v == int32(delta) {
		// The first increment must be synchronized with Wait.
		// Need to model this as a read, because there can be
		// several concurrent wg.counter transitions from 0.
		race.Read(unsafe.Pointer(semap))
	}
	// 如果加和后goroutine计数还变成负数了，那肯定有问题了，直接panic
	// 所以注意调用Done方法的次数要 <= Add进去的goroutine数量
	if v < 0 {
		panic("sync: negative WaitGroup counter")
	}
	// 到这里说明v>=0
	// WaitGroup是可以复用的，但是需要等到wait计数清零之后
	// 这里就是防止并发造成的叠加使用
	if w != 0 && delta > 0 && v == int32(delta) {
		panic("sync: WaitGroup misuse: Add called concurrently with Wait")
	}
	// 如果加和完之后goroutine计数还是 > 0 说明还有goroutine的Done还未执行或者只是单纯的添加了一些goroutine
	// 此时加和完后直接返回即可
	// 如果v<=0，结合上面的v>=0，可知道v=0，如果这个时候w=0，说明等待计数也清零了，也可以直接返回了
	if v > 0 || w == 0 {
		return
	}
	// This goroutine has set counter to 0 when waiters > 0.
	// Now there can't be concurrent mutations of state:
	// - Adds must not happen concurrently with Wait,
	// - Wait does not increment waiters if it sees counter == 0.
	// Still do a cheap sanity check to detect WaitGroup misuse.
	// 这里会做最后一次合法检查，如果由于并发调用Add、Done或者Wait方法导致了statep指向的state1中的uint32发生了改变
	// 直接panic
	if *statep != state {
		panic("sync: WaitGroup misuse: Add called concurrently with Wait")
	}
	// Reset waiters count to 0.
	// 到这里可以知道v=0，w!=0
	// 既然goroutine计数清零了，那么说明所有的goroutine都执行了Done方法了
	// 这个时候需要唤醒所有通过Wait睡眠的goroutine，而具体要唤醒多少，就需要使用等待计数了
	*statep = 0
	for ; w != 0; w-- {
		// 释放信号量，通过runtime_Semacquire唤醒被阻塞的waiter
		runtime_Semrelease(semap, false, 0)
	}
}

// Done decrements the WaitGroup counter by one.
// 调用Add方法，将goroutine计数减一
func (wg *WaitGroup) Done() {
	wg.Add(-1)
}
```

### Wait
```go
// Wait blocks until the WaitGroup counter is zero.
// 每次执行Wait，等待计数都会加1
func (wg *WaitGroup) Wait() {
	// 同样的操作
	statep, semap := wg.state()
	if race.Enabled {
		_ = *statep // trigger nil deref early
		race.Disable()
	}
	for {
		// 注意这里是个原子操作，因为如果32位机器，每次取四个字节，取一个uint64需要两次
		// 为了两次过程中目标不被更改，所以使用原子操作
		state := atomic.LoadUint64(statep)
		//取到goroutine计数和等待计数
		v := int32(state >> 32)
		w := uint32(state)
		// 如果还未添加goroutine，Wait什么也不用做，直接返回即可
		if v == 0 {
			// Counter is 0, no need to wait.
			if race.Enabled {
				race.Enable()
				race.Acquire(unsafe.Pointer(wg))
			}
			return
		}
		// Increment waiters count.
		// 这里又是一个原子操作，先比较再+1
		// 所以这里如果并发的调用Wait方法，可能会导致某些Wait方法失效
		if atomic.CompareAndSwapUint64(statep, state, state+1) {
			if race.Enabled && w == 0 {
				// Wait must be synchronized with the first Add.
				// Need to model this is as a write to race with the read in Add.
				// As a consequence, can do the write only for the first waiter,
				// otherwise concurrent Waits will race with each other.
				race.Write(unsafe.Pointer(semap))
			}
			// 该方法和runtime_Semrelease是一对
			// 当semap > 0的时候会被唤醒并将semap减1，这两个步骤是一个原子行为
			runtime_Semacquire(semap)
			// 通过Add方法可以知道，唤醒Wait之前会将statep重置为0
			// 这里会做进一步合法校验，如果statep不为0，也就是说Wait还未全部唤醒，WaitGroup就被重新使用并添加了goroutine
			if *statep != 0 {
				panic("sync: WaitGroup is reused before previous Wait has returned")
			}
			if race.Enabled {
				race.Enable()
				race.Acquire(unsafe.Pointer(wg))
			}
			// 唤醒完之后不用做，Wait阻塞会解除，对应的go程序会继续执行
			return
		}
	}
}
```

### 总结
`WaitGroup`巧妙的通过动态布局state1来适配多硬件体系的内存对齐，节省了内存空间，这个我们在构造结构体的时候，如果对内存占用要求很高，也需要注意调整布局来适配内存对齐，达到最小的内存占用；同时不要滥用`Add`和`Wait`方法，特别是并发场景下，老老实实套常用的写法即可