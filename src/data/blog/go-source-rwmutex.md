---
title: "Golang源码系列--rwmutex"
author: "Joker"
pubDatetime: 2019-04-05T01:01:49+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang rwmutex的实现源码解析"
---

### 概述
`rwmutex.go`即读写锁，内部基于`atomic`和`sync.mutex`实现，提供四个方法
 - RLock 读锁，阻塞Lock，不阻塞其他的Rlock
 - RUnlock 解读锁，与Rlock匹配
 - Lock 写锁，阻塞Rlock和其他Lock，不阻塞RUnlock
 - Unlock 解写锁，与Lock匹配

### Struct
```go
type RWMutex struct {
	w           Mutex  // 排他锁，用于Lock阻塞其他Lock
	writerSem   uint32 // 写信号
	readerSem   uint32 // 读信号
	readerCount int32  // Rlock锁的数量
	readerWait  int32  // Lock阻塞等待的Rlock锁的数量
}

const rwmutexMaxReaders = 1 << 30  // 注意这里不仅是一个限制读锁最大数量的标记，也是Lock阻塞RLock的工具
```

### RLock
/*注*/ 后续代码均抹掉race竞争检测部分
```go
func (rw *RWMutex) RLock() {
	if atomic.AddInt32(&rw.readerCount, 1) < 0 {
		// readerCount值加1，注意这里不是CAS操作
		// readerCount < 0 必然是有写Lock住了，等待
		runtime_Semacquire(&rw.readerSem)
	}
}
```
这里的`readerCount`为啥是`int32`，因为它可为负值，这里设计是很巧妙的，`readerCount`为正值的时候表示没有写锁，当`readerCount`为负值的时候表示有写锁，同时`readerCount`无论为正值还是负值，都可以对当前Rlock的数量进行记录

### RUnlock
```go
func (rw *RWMutex) RUnlock() {
	// readerCount减一
	if r := atomic.AddInt32(&rw.readerCount, -1); r < 0 {
		// 如果readerCount是正数，减1后小于0，重复RUnlock了
		// 如果readerCount是负数，说明此时有写锁占用着，减1后小于-rwmutexMaxReaders，重复RUnlock了
		if r+1 == 0 || r+1 == -rwmutexMaxReaders {
			race.Enable()
			throw("sync: RUnlock of unlocked RWMutex")
		}
		// 没有重复RUnlock，r < 0只可能此时被写锁占用了
 		// 因为只有写锁才会把readerCount置为负数进行标识
 		// 将阻塞写锁的读锁数readerWait减1，结果如果为0即所有读锁都解锁了，可以唤醒阻塞中的写锁了
		if atomic.AddInt32(&rw.readerWait, -1) == 0 {
			runtime_Semrelease(&rw.writerSem, false)
		}
	}
}
```
这里用到了`readerWait`来标识阻塞写锁的读锁的数量，这里可能会有人觉得困惑，为啥不直接用`readerCount = -rwmutexMaxReaders`来标识读锁全部解锁完了呢，这里需要注意的是就算写锁阻塞了读锁，但是读锁是没有用到互斥锁`mutex`的，所以就算阻塞了也已经执行了`atomic.AddInt32(&rw.readerCount, 1)`，只不过阻塞于待唤醒状态，所以readerCount其实是已经获得读锁和正在阻塞获得读锁的和，没法用来标记写锁要等待的读锁数，想一下这种情况，顺序执行如下操作
 - 先获得读锁50个  此时`readerCount = 50`
 - 再尝试获得写锁  此时写锁阻塞，读锁`readerCount = 50 - rwmutexMaxReaders`，写锁需要等待的读锁数`readerWait = 50`
 - 再获得读锁20个 全部阻塞，但是此时`readerCount = 50 - rwmutexMaxReaders + 20`，`readerWait = 50`
 - 解一个读锁 此时`readerCount = 50 - rwmutexMaxReaders + 20 - 1`，`readerWait = 50 -1`，这里尽管在写锁占用的同时尝试获得读锁引发了readerCount增加，但是不影响readerWait，同时也就不影响RUnlock唤醒写锁

### Lock
```go
func (rw *RWMutex) Lock() {
	// 互斥锁，锁住水分，哦不，锁住其他写
	rw.w.Lock()
	// 这里看仔细了，先让readerCount = readerCount - rwmutexMaxReaders变成负值，用来挡住其他读锁
	// 再算出原来的readerCount，这个值是已经获取成功的读锁数
	r := atomic.AddInt32(&rw.readerCount, -rwmutexMaxReaders) + rwmutexMaxReaders
	// 修改阻塞写锁的读锁数，如果不为0，则睡眠等待
	if r != 0 && atomic.AddInt32(&rw.readerWait, r) != 0 {
		runtime_Semacquire(&rw.writerSem)
	}
}
```

### Unlock
```go
func (rw *RWMutex) Unlock() {
	// readerCount = readerCount + rwmutexMaxReaders
	// 把readerCount变成正值，不再阻塞写锁的获取
	// 注意此时的readerCount表示所有阻塞中的读锁，因为只有所有已经获取成功的写锁全部解锁了才会走到写锁的Unlock里
	r := atomic.AddInt32(&rw.readerCount, rwmutexMaxReaders)
	// 如果r > rwmutexMaxReaders 只可能是执行了两次unlock
	if r >= rwmutexMaxReaders {
		race.Enable()
		throw("sync: Unlock of unlocked RWMutex")
	}
	// 唤醒所有阻塞中的读锁
	for i := 0; i < int(r); i++ {
		runtime_Semrelease(&rw.readerSem, false)
	}
	// 此次写锁完毕，解锁
	rw.w.Unlock()
}
```
这里继续上面的操作
 - 解49个读锁 此时`readerCount = 50 - rwmutexMaxReaders + 20 - 1 - 49`，`readerWait = 50 - 1 - 49`，此时`readerWait = 0`触发唤醒写锁
 - 执行解写锁 此时`readerCount = 50 - rwmutexMaxReaders + 20 - 1 - 49 + rwmutexMaxReaders = 20`，刚好是写锁占用期间尝试获取读锁的数量
这里要注意，如果把解49个读锁换成解49+20个读锁，RUnlock并不会报错，而之前那20个正在等待中的锁可能不会按照预期的时间被唤醒，举个栗子
```go
func main() {
	var m sync.RWMutex
	m.RLock()
	m.RLock()
	fmt.Println("double rlock succ")

	go func() {
		fmt.Println("lock begin...")
		m.Lock()
		fmt.Println("lock end")
		m.Unlock()
		fmt.Println("unlock succ")
	}()

	time.Sleep(time.Second)

	go func() {
		fmt.Println("try rlock...")
		m.RLock()   // 这把读锁不能被m.Unlock唤醒了
		fmt.Println("rlock end")
	}()

	time.Sleep(time.Second)

	m.RUnlock()
	m.RUnlock()
	m.RUnlock()  // 这个解读锁把阻塞中还未获取成功的读锁给解掉了

	time.Sleep(time.Second)
}

// output 
double rlock succ
lock begin...
try rlock...
lock end
unlock succ
```

再看看这个，Lock后还能RLock
```go
const rwmutexMaxReaders = 1 << 30 - 1

func main() {
	var m sync.RWMutex
	for i := rwmutexMaxReaders; i > 0; i-- {
		m.RLock()
	}

	fmt.Printf("%d rlock/n", rwmutexMaxReaders)

	go func() {
		m.Lock()
	}()

	time.Sleep(time.Second)

	fmt.Println("lock")

	m.RLock()

	fmt.Println("rlock again")
}

// output
1073741823 rlock
lock
rlock again
```
这是因为`RLock`方法中的判断`if atomic.AddInt32(&rw.readerCount, 1) < 0`，所以正如开头所说的`rwmutexMaxReaders`只是一个限制标记，不代表读锁数的最大值，这里面读锁数的最大值应该是`1 << 30 - 2`

### 总结
佩服