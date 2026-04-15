---
title: "Golang源码系列--channel"
author: "Joker"
pubDatetime: 2022-01-27T01:28:49+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang channel的实现源码解析"
---

### 概述
channel的实现相对map简单了不少，通过锁mutex来保证并发安全，同时只提供读写和关闭操作，channel支持有/无缓冲区，对于有缓冲区的channel，缓冲区大小也是在初始化的时候确定了，后续不会有扩容操作，一起来看看源码吧

### 源码
#### 初始化
```go
// channel结构体
type hchan struct {
	// 目前缓冲区已使用数量，对于无缓冲区的channel，qcount=0
	qcount   uint           // total data in the queue
	// 缓冲区大小 make(chan int, 3)其中3就是申请的缓冲区大小
	dataqsiz uint           // size of the circular queue
	// 指向缓冲区的指针，用于读/写缓冲区
	buf      unsafe.Pointer // points to an array of dataqsiz elements
	// channel的元素size
	elemsize uint16
	// channel是否已关闭，还记得close(ch)吧
	closed   uint32
	// channel的元素type
	elemtype *_type // element type
	// 写buf索引，通过buf + sendx可以算出写入位置
	sendx    uint   // send index
	// 读buf索引，通过buf + recvx可以算出取出位置
	recvx    uint   // receive index
	// 读channel队列(当缓存区已写满或无缓冲区的时候)，读动作会进行排队
	recvq    waitq  // list of recv waiters
	// 写channel队列，同上，写动作也会进行排队
	sendq    waitq  // list of send waiters

	// lock protects all fields in hchan, as well as several
	// fields in sudogs blocked on this channel.
	//
	// Do not change another G's status while holding this lock
	// (in particular, do not ready a G), as this can deadlock
	// with stack shrinking.
	// 并发锁
	lock mutex
}

// 排队队列结构
// 这里面包含了一个头指针和一个尾指针
// go通过双向链表实现读写channel队列，后面源码的时候会看到
// 至于sudog这里不做详细阐述，你可以认为是g在某个事件等待队列中的一个等待实体
// 因为一个g可能需要等待多个事件，所以需要sudog作为委托去等待，一旦sudog被唤醒，它就会通知g
type waitq struct {
	first *sudog
	last  *sudog
}


// channel初始化
func makechan(t *chantype, size int) *hchan {
	elem := t.elem

	// compiler checks this but be safe.
	// 控制channel elem的size，你可以试试构造一个size很大的struct，然后make对应的channel，就会报错
	if elem.size >= 1<<16 {
		throw("makechan: invalid channel element type")
	}
	if hchanSize%maxAlign != 0 || elem.align > maxAlign {
		throw("makechan: bad alignment")
	}

	// 控制缓存区大小
	// 不能小于0
	// 计算分配字节数的时候不能溢出
	// 不能超过可分配内存数
	mem, overflow := math.MulUintptr(elem.size, uintptr(size))
	if overflow || mem > maxAlloc-hchanSize || size < 0 {
		panic(plainError("makechan: size out of range"))
	}

	// Hchan does not contain pointers interesting for GC when elements stored in buf do not contain pointers.
	// buf points into the same allocation, elemtype is persistent.
	// SudoG's are referenced from their owning thread so they can't be collected.
	// TODO(dvyukov,rlh): Rethink when collector can move allocated objects.
	// 声明一个hchan指针
	var c *hchan
	// 这里分三种情况进行初始化
	switch {
	// 第一种无缓存区
	case mem == 0:
		// Queue or element size is zero.
		// 不用分配buf，只分配hchan
		c = (*hchan)(mallocgc(hchanSize, nil, true))
		// Race detector uses this location for synchronization.
		// 用于竞态检测，本次源码不阐述，感兴趣自己去翻阅
		c.buf = c.raceaddr()
	// 第二种有缓冲区且channel元素不包含指针类型
	case elem.ptrdata == 0:
		// Elements do not contain pointers.
		// Allocate hchan and buf in one call.
		// 直接申请一整块内存，一个是方便gc，另外一个是减少内存碎片
		c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
		c.buf = add(unsafe.Pointer(c), hchanSize)
	// 第三种有缓冲区且channel元素包含指针类型
	default:
		// Elements contain pointers.
		// 分开申请hchan和buf
		c = new(hchan)
		c.buf = mallocgc(mem, elem, true)
	}

	// 初始化工作
	// 元素size、元素类型、缓冲区大小和锁
	c.elemsize = uint16(elem.size)
	c.elemtype = elem
	c.dataqsiz = uint(size)
	lockInit(&c.lock, lockRankHchan)

	if debugChan {
		print("makechan: chan=", c, "; elemsize=", elem.size, "; dataqsiz=", size, "\n")
	}
	return c
}
```
#### 写channel
写channel的核心函数是chansend，同时有两个对chansend包装的函数，分别是chansend1和selectnbsend，对应阻塞和非阻塞模式，阻塞模式我们都知道，比如ch <- x，就可能发生阻塞，而非阻塞模式就是通过select...case来调用，这里集中看下chansend的源码
```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
	// 如果channel是nil
	if c == nil {
		// 如果非阻塞模式，返回false
		if !block {
			return false
		}
		// 如果是阻塞模式，就让当前g睡眠等待即挂起
		// 至于gopark是怎么做的，后面会有单独文章来聊聊g调度，这里知道是做什么的就行
		gopark(nil, nil, waitReasonChanSendNilChan, traceEvGoStop, 2)
		throw("unreachable")
	}

	if debugChan {
		print("chansend: chan=", c, "\n")
	}

	if raceenabled {
		racereadpc(c.raceaddr(), callerpc, funcPC(chansend))
	}

	// Fast path: check for failed non-blocking operation without acquiring the lock.
	//
	// After observing that the channel is not closed, we observe that the channel is
	// not ready for sending. Each of these observations is a single word-sized read
	// (first c.closed and second full()).
	// Because a closed channel cannot transition from 'ready for sending' to
	// 'not ready for sending', even if the channel is closed between the two observations,
	// they imply a moment between the two when the channel was both not yet closed
	// and not ready for sending. We behave as if we observed the channel at that moment,
	// and report that the send cannot proceed.
	//
	// It is okay if the reads are reordered here: if we observe that the channel is not
	// ready for sending and then observe that it is not closed, that implies that the
	// channel wasn't closed during the first observation. However, nothing here
	// guarantees forward progress. We rely on the side effects of lock release in
	// chanrecv() and closechan() to update this thread's view of c.closed and full().
	// 这里是对非阻塞模式的一个快速判断，可以不用加锁，减少锁的频率，提升性能
	// 如果非阻塞模式 + channel没有关闭 + channel缓存区已经满了
	// 这个时候肯定是写不进去了，返回false
	if !block && c.closed == 0 && full(c) {
		return false
	}

	var t0 int64
	if blockprofilerate > 0 {
		t0 = cputicks()
	}

	// 加锁
	lock(&c.lock)

	// 如果channle关闭了
	// 还记得吗，对一个closed的channel进行写入操作，是会引发panic的，即使是select语句也不例外
	if c.closed != 0 {
		// 解锁
		unlock(&c.lock)
		panic(plainError("send on closed channel"))
	}

	// 如果channel没关闭并且读等待队列中有等待的sg，直接取出并将ep传递过去
	// dequeue是从双向链中取头一个sg，尾部排队，头部取出，严格FIFO，保证recvq的顺序性
	if sg := c.recvq.dequeue(); sg != nil {
		// Found a waiting receiver. We pass the value we want to send
		// directly to the receiver, bypassing the channel buffer (if any).
		// send就是将要写入的ep传递给取出的sg，同时会调用unlock解锁
		// 这里只是将sg唤醒，具体后续是sg对应的g的动作了
		send(c, sg, ep, func() { unlock(&c.lock) }, 3)
		return true
	}

	// 如果channel没关闭，没有等待读的sg，且缓冲区没空，就写到缓冲区中
	if c.qcount < c.dataqsiz {
		// Space is available in the channel buffer. Enqueue the element to send.
		// chanbuf就是通过c + sendx来找到写入位置，sendx下标是从0开始的
		qp := chanbuf(c, c.sendx)
		if raceenabled {
			racenotify(c, c.sendx, nil)
		}
		// 传递ep
		typedmemmove(c.elemtype, qp, ep)
		// 索引+1
		c.sendx++
		// 这里可以指导，buf逻辑上是一个环形的结构体，当sendx大于总长时，就从0开始，即从头开始
		// 有点类似mysql的redo log结构，一个环 + 写入标志 + 读取(擦除)标志
		if c.sendx == c.dataqsiz {
			c.sendx = 0
		}
		// 缓冲区元素数量+1
		c.qcount++
		// 解锁
		unlock(&c.lock)
		return true
	}

	// 如果channel没关闭，没有等待读的sg，没有缓冲区或者缓冲区满了
	// 如果是非阻塞模式，解锁，返回false即可
	if !block {
		unlock(&c.lock)
		return false
	}

	// 如果是阻塞模式，不好意思，构造本g的等待实体mysg，挂起等待
	// Block on the channel. Some receiver will complete our operation for us.
	gp := getg()
	mysg := acquireSudog()
	mysg.releasetime = 0
	if t0 != 0 {
		mysg.releasetime = -1
	}
	// No stack splits between assigning elem and enqueuing mysg
	// on gp.waiting where copystack can find it.
	mysg.elem = ep
	mysg.waitlink = nil
	mysg.g = gp
	mysg.isSelect = false
	mysg.c = c
	gp.waiting = mysg
	gp.param = nil
	// enqueue就是将mysq挂到sendq中
	c.sendq.enqueue(mysg)
	// Signal to anyone trying to shrink our stack that we're about
	// to park on a channel. The window between when this G's status
	// changes and when we set gp.activeStackChans is not safe for
	// stack shrinking.
	atomic.Store8(&gp.parkingOnChan, 1)
	// gopark功能同上，将当前的g置为等待状态并解锁c.lock
	gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceEvGoBlockSend, 2)
	// Ensure the value being sent is kept alive until the
	// receiver copies it out. The sudog has a pointer to the
	// stack object, but sudogs aren't considered as roots of the
	// stack tracer.
	KeepAlive(ep)

	// someone woke us up.
	// 对应唤醒后的动作
	if mysg != gp.waiting {
		throw("G waiting list is corrupted")
	}
	gp.waiting = nil
	gp.activeStackChans = false
	closed := !mysg.success
	gp.param = nil
	if mysg.releasetime > 0 {
		blockevent(mysg.releasetime-t0, 2)
	}
	mysg.c = nil
	releaseSudog(mysg)
	if closed {
		if c.closed == 0 {
			throw("chansend: spurious wakeup")
		}
		panic(plainError("send on closed channel"))
	}
	return true
}
```
#### 读channel
读channel的核心函数是chanrecv，有对应三个包装函数，分别是chanrecv1、chanrecv2和selectnbrecv，前面两个对应阻塞模式，后面对应非阻塞模式，即配合select...case使用，chanrecv1和chanrecv2区别就是chanrecv2会多返回一个bool类型值，注意这个不可用于判断channel是否关闭，只能用于判断是否从channel中读取到数据
```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
	// raceenabled: don't need to check ep, as it is always on the stack
	// or is new memory allocated by reflect.

	if debugChan {
		print("chanrecv: chan=", c, "\n")
	}

	// 同chansend
	if c == nil {
		if !block {
			return
		}
		gopark(nil, nil, waitReasonChanReceiveNilChan, traceEvGoStop, 2)
		throw("unreachable")
	}

	// Fast path: check for failed non-blocking operation without acquiring the lock.
	// 无锁模式快速判断非阻塞模式下是否会读channel失败
	// empty会确认是否是无缓存区或者缓存区是空的
	if !block && empty(c) {
		// After observing that the channel is not ready for receiving, we observe whether the
		// channel is closed.
		//
		// Reordering of these checks could lead to incorrect behavior when racing with a close.
		// For example, if the channel was open and not empty, was closed, and then drained,
		// reordered reads could incorrectly indicate "open and empty". To prevent reordering,
		// we use atomic loads for both checks, and rely on emptying and closing to happen in
		// separate critical sections under the same lock.  This assumption fails when closing
		// an unbuffered channel with a blocked send, but that is an error condition anyway.
		// empty无法确认channel是否关闭
		// 如果channel没关闭，且无缓冲区或者缓冲区是空的，返回false
		if atomic.Load(&c.closed) == 0 {
			// Because a channel cannot be reopened, the later observation of the channel
			// being not closed implies that it was also not closed at the moment of the
			// first observation. We behave as if we observed the channel at that moment
			// and report that the receive cannot proceed.
			// 这里selected是false，配合select...case来看就明白了
			return
		}
		// The channel is irreversibly closed. Re-check whether the channel has any pending data
		// to receive, which could have arrived between the empty and closed checks above.
		// Sequential consistency is also required here, when racing with such a send.
		// 如果channel关闭了，再次通过empty函数确认
		if empty(c) {
			// The channel is irreversibly closed and empty.
			if raceenabled {
				raceacquire(c.raceaddr())
			}
			// 这里会将ep指向的内存清零，还记得吗，读取一个关闭的channel，返回的是类型零值，就是这里清零的
			if ep != nil {
				typedmemclr(c.elemtype, ep)
			}
			// 这里selected是true
			return true, false
		}
	}

	var t0 int64
	if blockprofilerate > 0 {
		t0 = cputicks()
	}

	// 上锁
	lock(&c.lock)

	// 如果channel关闭了并且没有缓冲区或者缓冲区是空的
	// 同样返回类型零值，selected是true
	// 这里说明一下，就是即使channel关闭了，如果buf中还有数据没读完，是可以继续读的
	// 这也是为什么还要判断c.qcount=0的原因
	if c.closed != 0 && c.qcount == 0 {
		if raceenabled {
			raceacquire(c.raceaddr())
		}
		unlock(&c.lock)
		if ep != nil {
			typedmemclr(c.elemtype, ep)
		}
		return true, false
	}

	// 如果channel没关闭并且有正在等待写的sg
	// 直接将sg要写的数据传递给ep
	// dequeue方法上面说过了
	if sg := c.sendq.dequeue(); sg != nil {
		// Found a waiting sender. If buffer is size 0, receive value
		// directly from sender. Otherwise, receive from head of queue
		// and add sender's value to the tail of the queue (both map to
		// the same buffer slot because the queue is full).
		// recv方法与send方法动作几乎一样
		// 将sg要写的数据传递给ep
		// 唤醒sg继续做后面的事
		// 有一个不同的地方，就是对于send，如果有等待读的sg，那么要么无缓冲区，要么是空的缓冲区
		// 这个时候是不需要改变sendx和recvx的，因为buf是空的环，只要sendx和recvx的相对位置不变，在哪里无所谓
		// 但是对于recv就不同了，如果有等待写的sg，那么要么无缓冲区，要么缓冲区满了，这个时候recvx=sendx
		// 如果无缓冲区，也不用改变sendx和recvx
		// 如果有缓冲区，那么需要将缓冲区对应recvx位置的数据传递给ep
		// 然后将sg的的数据传递给recvx对应的内存，然后recvx和sendx都需要加1，此时从sg读取到的数据就会在buf环的最后
		// 这样做才能保证channel的读取顺序性
		recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
		return true, true
	}

	// 如果channel的buf中还有数据就继续读取
	if c.qcount > 0 {
		// Receive directly from queue
		// 通过c + recvx找到对应的读取位置
		qp := chanbuf(c, c.recvx)
		if raceenabled {
			racenotify(c, c.recvx, nil)
		}
		// 传递给ep
		if ep != nil {
			typedmemmove(c.elemtype, ep, qp)
		}
		// 擦除qp
		typedmemclr(c.elemtype, qp)
		// 读索引加1
		c.recvx++
		// 回环
		if c.recvx == c.dataqsiz {
			c.recvx = 0
		}
		// buf数据量减1
		c.qcount--
		// 解锁
		unlock(&c.lock)
		// 返回
		return true, true
	}

	// 如果channel没有关闭且没有等待写的sg且无缓冲区或缓冲区是空的
	// 非阻塞模式下返回false
	if !block {
		unlock(&c.lock)
		return false, false
	}

	// 阻塞模式下回将当前g挂起等待
	// no sender available: block on this channel.
	gp := getg()
	mysg := acquireSudog()
	mysg.releasetime = 0
	if t0 != 0 {
		mysg.releasetime = -1
	}
	// No stack splits between assigning elem and enqueuing mysg
	// on gp.waiting where copystack can find it.
	mysg.elem = ep
	mysg.waitlink = nil
	gp.waiting = mysg
	mysg.g = gp
	mysg.isSelect = false
	mysg.c = c
	gp.param = nil
	// 将mysg挂到recvq中
	c.recvq.enqueue(mysg)
	// Signal to anyone trying to shrink our stack that we're about
	// to park on a channel. The window between when this G's status
	// changes and when we set gp.activeStackChans is not safe for
	// stack shrinking.
	atomic.Store8(&gp.parkingOnChan, 1)
	gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanReceive, traceEvGoBlockRecv, 2)

	// someone woke us up
	if mysg != gp.waiting {
		throw("G waiting list is corrupted")
	}
	gp.waiting = nil
	gp.activeStackChans = false
	if mysg.releasetime > 0 {
		blockevent(mysg.releasetime-t0, 2)
	}
	success := mysg.success
	gp.param = nil
	mysg.c = nil
	releaseSudog(mysg)
	return true, success
}
```
#### 关闭channel
```go
// 关闭channel做几件事
// closed置为1
// 收集读等待队列recvq的所有sg，每个sg的elem都设为类型零值
// 收集写等待队列sendq的所有sg，每个sg的elem都设为nil
// 唤醒所有收集的sg
func closechan(c *hchan) {
	// close一个nil的channel是会panic的
	if c == nil {
		panic(plainError("close of nil channel"))
	}

	lock(&c.lock)
	// 重复close一个channel也是会panic的
	if c.closed != 0 {
		unlock(&c.lock)
		panic(plainError("close of closed channel"))
	}

	if raceenabled {
		callerpc := getcallerpc()
		racewritepc(c.raceaddr(), callerpc, funcPC(closechan))
		racerelease(c.raceaddr())
	}
	// 设置关闭标志
	c.closed = 1

	var glist gList

	// release all readers
	// 收集读sg
	for {
		sg := c.recvq.dequeue()
		// 空队列，跳出循环
		if sg == nil {
			break
		}
		// 清零elem
		if sg.elem != nil {
			typedmemclr(c.elemtype, sg.elem)
			sg.elem = nil
		}
		if sg.releasetime != 0 {
			sg.releasetime = cputicks()
		}
		gp := sg.g
		gp.param = unsafe.Pointer(sg)
		sg.success = false
		if raceenabled {
			raceacquireg(gp, c.raceaddr())
		}
		glist.push(gp)
	}

	// release all writers (they will panic)
	// 收集写sg
	for {
		sg := c.sendq.dequeue()
		// 空队列，跳出循环
		if sg == nil {
			break
		}
		// elem置为nil
		sg.elem = nil
		if sg.releasetime != 0 {
			sg.releasetime = cputicks()
		}
		gp := sg.g
		gp.param = unsafe.Pointer(sg)
		sg.success = false
		if raceenabled {
			raceacquireg(gp, c.raceaddr())
		}
		glist.push(gp)
	}
	unlock(&c.lock)

	// Ready all Gs now that we've dropped the channel lock.
	// 唤醒所有收集到的sg
	for !glist.empty() {
		gp := glist.pop()
		gp.schedlink = 0
		goready(gp, 3)
	}
}
```
### 总结
抛开g的调度那些跟channel无关的代码，channel的实现还是挺简单的，通过两个等待FIFO队列、一个环形buf和一把锁实现了通道并发安全的通信，不过细细琢磨还是有点疑问的，比如chansend和chanrecv针对非阻塞模式的无锁快速试错部分，不加锁是否有可能造成诡异的结果，为什么只有这部分可以无锁，无锁的范围还能扩大吗？今天脑壳疼，就不细想了，留给读者吧