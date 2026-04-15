---
title: "Golang源码系列--sync.pool"
author: "Joker"
pubDatetime: 2022-02-16T13:36:02+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang sync.pool的实现源码解析"
---

### 概述
`sync.pool` 主要用于暂时保存对象，提供存取操作，可以复用对象以避免频繁的创建对象，当goroutine很多，频繁的创建某个对象时，可能会形成并发⼤－占⽤内存⼤－GC 缓慢－处理并发能⼒降低－并发更⼤这样的恶性循环，不过`sync.pool`不能用于数据库连接池，因为`pool`池会定期自动触发GC回收对象，至于用法就不赘述了，下面主要解读源码

### 结构
```go
// pool池
type Pool struct {
	// 禁止copy，之前的文章讲过，这里不多说了
	noCopy noCopy

	// 对象池，指向[P]poolLocal切片的指针
	// 这里的P是通过runtime.GOMAXPROCS获得，不过不知道什么是P，可以先看下go的GPM模型
	// 这里默认poolLocal切片的长度是P主要有两个好处
	// 一个是将缓存池进行了分段，减少了操作锁粒度，类似mysql的组提交
	// 另外一个是同一个P绑定到M之后，同一时间只会调度一个G，也就天然的防止了P维度下的并发
	local     unsafe.Pointer // local fixed-size per-P pool, actual type is [P]poolLocal
	// poolLocal元素个数  
	localSize uintptr        // size of the local array

	// victim会在一轮GC到来的时候做两件事
	// 一个是释放自己占用的内存
	// 另外一个是接管local
	// 也就是说pool池的内存释放会有两轮GC的间隔，具体看后续源码
	victim     unsafe.Pointer // local from previous cycle
	victimSize uintptr        // size of victims array

	// New optionally specifies a function to generate
	// a value when Get would otherwise return nil.
	// It may not be changed concurrently with calls to Get.
	// 新建对象的方法，当pool池中没有可用的对象时，会调用该方法创建一个新的对象
	New func() interface{}
}

// pool池的分段结构体
type poolLocal struct {
	// 内嵌poolLocalInternal
	// 这里内嵌主要是为了下面好计算size
	poolLocalInternal

	// Prevents false sharing on widespread platforms with
	// 128 mod (cache line size) = 0 .
	// 这里加一些pad主要是为了防止cpu缓存的伪共享，也是为了提升频繁存取的性能
	// 至于伪共享，可以看看 https://zhuanlan.zhihu.com/p/65394173
	pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}

// 内嵌的存储结构体
// Local per-P Pool appendix.
type poolLocalInternal struct {
	// 私有，只能被当前P使用，比从poolChain更快获取到对象，也是为了提升频繁存取的性能
	private interface{} // Can be used only by the respective P.
	// 共享，所有P都能使用，但是有部分限制，这个后面再说
	shared  poolChain   // Local P can pushHead/popHead; any P can popTail.
}

// 实际存储对象的逻辑结构是一个双向链表，然后每个链表节点是一个环形队列
// 这里是链表的头尾节点
type poolChain struct {
	// head is the poolDequeue to push to. This is only accessed
	// by the producer, so doesn't need to be synchronized.
	head *poolChainElt

	// tail is the poolDequeue to popTail from. This is accessed
	// by consumers, so reads and writes must be atomic.
	tail *poolChainElt
}

// 链表节点
type poolChainElt struct {
	// 环形队列
	poolDequeue

	// next and prev link to the adjacent poolChainElts in this
	// poolChain.
	//
	// next is written atomically by the producer and read
	// atomically by the consumer. It only transitions from nil to
	// non-nil.
	//
	// prev is written atomically by the consumer and read
	// atomically by the producer. It only transitions from
	// non-nil to nil.
	// 前后向指针
	next, prev *poolChainElt
}

// 环形队列
type poolDequeue struct {
	// headTail packs together a 32-bit head index and a 32-bit
	// tail index. Both are indexes into vals modulo len(vals)-1.
	//
	// tail = index of oldest data in queue
	// head = index of next slot to fill
	//
	// Slots in the range [tail, head) are owned by consumers.
	// A consumer continues to own a slot outside this range until
	// it nils the slot, at which point ownership passes to the
	// producer.
	//
	// The head index is stored in the most-significant bits so
	// that we can atomically add to it and the overflow is
	// harmless.
	// 64位的整型，高32位用来记录环head的位置，低32位用来记录环tail的位置
	// 而且head代表的是当前要写入的位置，所以实际的存储区间是[tail, head)
	headTail uint64

	// vals is a ring buffer of interface{} values stored in this
	// dequeue. The size of this must be a power of 2.
	//
	// vals[i].typ is nil if the slot is empty and non-nil
	// otherwise. A slot is still in use until *both* the tail
	// index has moved beyond it and typ has been set to nil. This
	// is set to nil atomically by the consumer and read
	// atomically by the producer.
	// 环，这里用eface这个结构体也是有妙用的，后面具体会说
	vals []eface
}

type eface struct {
	typ, val unsafe.Pointer
}
```
这里附上一张整体的结构体辅助理解
![02.png](/images/go-source/02.png)


### Put
```go
var (
	// 全局锁
	allPoolsMu Mutex

	// allPools is the set of pools that have non-empty primary
	// caches. Protected by either 1) allPoolsMu and pinning or 2)
	// STW.
	// 存储所有的pool池
	allPools []*Pool

	// oldPools is the set of pools that may have non-empty victim
	// caches. Protected by STW.
	// 需要被GC回收的pool池
	oldPools []*Pool
)

// 存入
func (p *Pool) Put(x interface{}) {
	// 不允许存入nil
	if x == nil {
		return
	}
	// 竞态检测
	if race.Enabled {
		if fastrand()%4 == 0 {
			// Randomly drop x on floor.
			return
		}
		race.ReleaseMerge(poolRaceAddr(x))
		race.Disable()
	}
	// 获取指向poolLocal的指针
	l, _ := p.pin()
	// 正如上面说的，private可用于快速的存取
	// 这里判断后会存入对象到private中
	if l.private == nil {
		l.private = x
		x = nil
	}
	// 如果没有存入private
	if x != nil {
		// 那就存到环形队列中，pushHead方法后面会说
		l.shared.pushHead(x)
	}
	// 因为pin方法中会禁止当前M被抢占，也就是绑定的P和M不会改变
	// 所以这里需要解除禁止
	runtime_procUnpin()
	if race.Enabled {
		race.Enable()
	}
}


// pin pins the current goroutine to P, disables preemption and
// returns poolLocal pool for the P and the P's id.
// Caller must call runtime_procUnpin() when done with the pool.
// pin主要是获取当前P的pid和poolLocal
func (p *Pool) pin() (*poolLocal, int) {
	// 这里禁止M被抢占，也就会防止GC触发pool池回收，
	// 具体为啥看下GMP的调度就知道了，一轮GC的时候会尝试抢占所有的P并停掉，只有STW之后才能进行GC
	pid := runtime_procPin()
	// In pinSlow we store to local and then to localSize, here we load in opposite order.
	// Since we've disabled preemption, GC cannot happen in between.
	// Thus here we must observe local at least as large localSize.
	// We can observe a newer/larger local, it is fine (we must observe its zero-initialized-ness).
	// 获取localSize
	s := runtime_LoadAcquintptr(&p.localSize) // load-acquire
	l := p.local                              // load-consume
	// 如果pid < s，那说明localSize已经有值了，poolLocal已经初始化过了
	// poolLocal通过pid和P对应，所以poolLocal[pid]就是当前要找的目标分段
	if uintptr(pid) < s {
		return indexLocal(l, pid), pid
	}
	// 到这里说uintptr(pid) >= s
	// 只有两种可能，一种是pool池还没初始化，也就是说poolLocal还没创建，localSize为0
	// 第二种就是调大了P的数量
	// 这两种都会触发重新初始化
	return p.pinSlow()
}

// 通过索引找到目标poolLocal
func indexLocal(l unsafe.Pointer, i int) *poolLocal {
	// 简单的指针计算，l指向poolLocal数组，l+i*sizeof(poolLocal) = poolLocal[i]
	lp := unsafe.Pointer(uintptr(l) + uintptr(i)*unsafe.Sizeof(poolLocal{}))
	return (*poolLocal)(lp)
}

// 初始化操作
func (p *Pool) pinSlow() (*poolLocal, int) {
	// Retry under the mutex.
	// Can not lock the mutex while pinned.
	// 到这里说明需要重新初始化了，而且后面有加全局锁操作，可能导致当前g睡眠
	// 这里是可以进行GC的，所以解除禁止M被抢占
	runtime_procUnpin()
	// 加全局锁，因为会操作全局的allPools
	allPoolsMu.Lock()
	defer allPoolsMu.Unlock()
	// 到这里又要防止GC触发了
	pid := runtime_procPin()
	// poolCleanup won't be called while we are pinned.
	s := p.localSize
	l := p.local
	// 再检查一次，因为有可能在上面短暂的解除禁止M被抢占后，可能M调度了别的G，然后该G进行了初始化
	if uintptr(pid) < s {
		return indexLocal(l, pid), pid
	}
	// 第一次初始化，加到全局pool池中，方便后续定期的GC回收
	if p.local == nil {
		allPools = append(allPools, p)
	}
	// If GOMAXPROCS changes between GCs, we re-allocate the array and lose the old one.
	// 获取P的数量
	size := runtime.GOMAXPROCS(0)
	// 创建poolLocal切片
	local := make([]poolLocal, size)
	// local指向poolLocal
	atomic.StorePointer(&p.local, unsafe.Pointer(&local[0])) // store-release
	// localSize=P的数量
	runtime_StoreReluintptr(&p.localSize, uintptr(size))     // store-release
	// 返回具体的poolLocal和pid
	return &local[pid], pid
}
```
这里的Put操作只说到了poolLocal，其实后面还会继续向poolChain中存入对象，这个先放到后面

### Get
```go
// 获取对象
func (p *Pool) Get() interface{} {
	if race.Enabled {
		race.Disable()
	}
	// 跟存入一样的操作，可能会触发初始化
	l, pid := p.pin()
	// 优先取私有的private
	x := l.private
	l.private = nil
	if x == nil {
		// Try to pop the head of the local shard. We prefer
		// the head over the tail for temporal locality of
		// reuse.
		// private没有就从share里面取，popHead后面统一说
		x, _ = l.shared.popHead()
		if x == nil {
			// 如果还没有就只能从其他分段的poolLocal里面取了
			x = p.getSlow(pid)
		}
	}
	runtime_procUnpin()
	if race.Enabled {
		race.Enable()
		if x != nil {
			race.Acquire(poolRaceAddr(x))
		}
	}
	// 还没取到，那只能调用New方法创建一个新的了
	if x == nil && p.New != nil {
		x = p.New()
	}
	return x
}

// 从别的poolLocal中获取对象
func (p *Pool) getSlow(pid int) interface{} {
	// See the comment in pin regarding ordering of the loads.
	// 获取local和对应的size
	size := runtime_LoadAcquintptr(&p.localSize) // load-acquire
	locals := p.local                            // load-consume
	// Try to steal one element from other procs.
	// 这里会循环找除自身外其他的所有的poolLocal
	for i := 0; i < int(size); i++ {
		// 注意这里的取模，pid是当前poolLocal的索引，pid+i+1随着i的递增会遍历所有其他的poolLocal
		l := indexLocal(locals, (pid+i+1)%int(size))
		// 因为是从其他的poolLocal获取对象，所以不能获取private，只能获取share
		// 如果这里也能获取private，那么又得考虑并发安全，无论是加锁还是使用复杂的逻辑结构，都跟private的初衷即加快存取性能有违背
		// 注意这里只能从popTail取，popTail后面会说，后面再解释为啥这里只能从popTail取
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}

	// Try the victim cache. We do this after attempting to steal
	// from all primary caches because we want objects in the
	// victim cache to age out if at all possible.
	// 还没找到，只能尝试从victim中找了
	// 其实victim将在下一轮GC中被回收，此处可以当做二级缓存来用，可以增加pool池的命中率
	// 查找的操作基本跟上面一致
	size = atomic.LoadUintptr(&p.victimSize)
	// 这里会通过前置判断来减少不必要的查找
	if uintptr(pid) >= size {
		return nil
	}
	locals = p.victim
	l := indexLocal(locals, pid)
	if x := l.private; x != nil {
		l.private = nil
		return x
	}
	for i := 0; i < int(size); i++ {
		l := indexLocal(locals, (pid+i)%int(size))
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}

	// Mark the victim cache as empty for future gets don't bother
	// with it.
	// 到这里说明victim也取不到对象，而victim此时只会静静等待GC回收了，不会有改变了
	// 所以将victimSize置为0，跟前面的前置判断相呼应
	atomic.StoreUintptr(&p.victimSize, 0)

	return nil
}
```
到这里，`sync.pool`的存取对象操作流程就说完了，继续往下一层看看`poolChain`的`pushHead`、`popHead`和`popTail`操作

### poolChain
```go
func storePoolChainElt(pp **poolChainElt, v *poolChainElt) {
	atomic.StorePointer((*unsafe.Pointer)(unsafe.Pointer(pp)), unsafe.Pointer(v))
}

func loadPoolChainElt(pp **poolChainElt) *poolChainElt {
	return (*poolChainElt)(atomic.LoadPointer((*unsafe.Pointer)(unsafe.Pointer(pp))))
}

// 从头存入对象
func (c *poolChain) pushHead(val interface{}) {
	// 获取链表的头节点
	d := c.head
	// 如果还没有头节点就创建一个
	if d == nil {
		// Initialize the chain.
		// 节点环队列的长度初始为8，后续每增加一个节点，长度*2(即始终是2的倍数)，原因后面说
		const initSize = 8 // Must be a power of 2
		d = new(poolChainElt)
		// 初始化环队列
		d.vals = make([]eface, initSize)
		// 新节点连到链表中
		c.head = d
		storePoolChainElt(&c.tail, d)
	}

	// 向环队列头添加val，pushHead后面会说，现在先说链表维度的
	if d.pushHead(val) {
		return
	}

	// The current dequeue is full. Allocate a new one of twice
	// the size.
	// 如果头节点的环队列满了，插入失败，就再新建一个节点，size*2
	newSize := len(d.vals) * 2
	// 这里有一个环队列的长度门限值
	if newSize >= dequeueLimit {
		// Can't make it any bigger.
		newSize = dequeueLimit
	}

	// 同样的操作
	// 注意这是prev指针指向d而不是next
	// 因为这里是根据创建顺序来的，d在d2之前创建的，所以是prev指向d
	// 而此时d2是头节点，所以感知上是反序的
	d2 := &poolChainElt{prev: d}
	d2.vals = make([]eface, newSize)
	// 将新节点加入到链表中且是新的头节点
	c.head = d2
	// d.next指向d2
	storePoolChainElt(&d.next, d2)
	// 存入val
	d2.pushHead(val)
}

// 从头部取出对象
func (c *poolChain) popHead() (interface{}, bool) {
	d := c.head
	// 如果没有头节点，那说明还没存入，返回nil
	for d != nil {
		// 从环队列中取
		if val, ok := d.popHead(); ok {
			return val, ok
		}
		// There may still be unconsumed elements in the
		// previous dequeue, so try backing up.
		// 如果当前节点没找到，继续向后找
		d = loadPoolChainElt(&d.prev)
	}
	return nil, false
}

func (c *poolChain) popTail() (interface{}, bool) {
	// 取到尾部节点
	d := loadPoolChainElt(&c.tail)
	// 还未存入对象
	if d == nil {
		return nil, false
	}

	for {
		// It's important that we load the next pointer
		// *before* popping the tail. In general, d may be
		// transiently empty, but if next is non-nil before
		// the pop and the pop fails, then d is permanently
		// empty, which is the only condition under which it's
		// safe to drop d from the chain.
		// 向前获取一个节点
		d2 := loadPoolChainElt(&d.next)

		// 如果获取到了则返回
		if val, ok := d.popTail(); ok {
			return val, ok
		}

		// 否则如果尾节点环队列是空的，并且前一个节点的环队列也是空的
		// 就说明所有的节点的环队列现在都是空的，不用往前找了
		// 因为除了popTail操作外就只有pushHead和popHead操作，这两个操作可以认为是入栈和出栈，如果栈底是空的那么整个栈都是空的
		if d2 == nil {
			// This is the only dequeue. It's empty right
			// now, but could be pushed to in the future.
			return nil, false
		}

		// The tail of the chain has been drained, so move on
		// to the next dequeue. Try to drop it from the chain
		// so the next pop doesn't have to look at the empty
		// dequeue again.
		// 这里是个原子操作，因为会有多个其他的goroutine来窃取对象
		// 将tail指针往前挪，删除掉当前空的tail节点
		// 为什么要删掉，因为这部分空的节点不可能再使用了，因为存入只有pushHead操作，而pushHead始终都是往头部插入的
		if atomic.CompareAndSwapPointer((*unsafe.Pointer)(unsafe.Pointer(&c.tail)), unsafe.Pointer(d), unsafe.Pointer(d2)) {
			// We won the race. Clear the prev pointer so
			// the garbage collector can collect the empty
			// dequeue and so popHead doesn't back up
			// further than necessary.
			storePoolChainElt(&d2.prev, nil)
		}
		// 继续往前遍历
		d = d2
	}
}
```
到这里链表`poolChain`也说完了，再往下一层就是节点`poolDequeue`，也是真正存取的对象

### poolDequeue
```go
type dequeueNil *struct{}

// 还记得吧，前面说的poolDequeue的headTail是通过高低位来表示head和tail的
// 解出head和tail
func (d *poolDequeue) unpack(ptrs uint64) (head, tail uint32) {
	// const dequeueBits = 32
	const mask = 1<<dequeueBits - 1
	// 取高32位
	head = uint32((ptrs >> dequeueBits) & mask)
	// 取低32位
	tail = uint32(ptrs & mask)
	return
}

// 组合headTail
func (d *poolDequeue) pack(head, tail uint32) uint64 {
	const mask = 1<<dequeueBits - 1
	return (uint64(head) << dequeueBits) |
		uint64(tail&mask)
}

// pushHead adds val at the head of the queue. It returns false if the
// queue is full. It must only be called by a single producer.
func (d *poolDequeue) pushHead(val interface{}) bool {
	// 获取head和tail
	ptrs := atomic.LoadUint64(&d.headTail)
	head, tail := d.unpack(ptrs)
	// 判断队列是否满了
	if (tail+uint32(len(d.vals)))&(1<<dequeueBits-1) == head {
		// Queue is full.
		return false
	}
	// 因为head有可能是一直递增的(配合popTail)，这里通过取模mask来得到正确的索引
	// 这里就是为什么环队列的长度始终是2的倍数了，就是为了方便得到mask进行取模
	// 这种取模的方式类似redis的sds
	slot := &d.vals[head&uint32(len(d.vals)-1)]

	// Check if the head slot has been released by popTail.
	// 获取目标slot的typ
	typ := atomic.LoadPointer(&slot.typ)
	// 如果typ不为空，说明有popTail还没执行完，不能并发进行，放弃
	if typ != nil {
		// Another goroutine is still cleaning up the tail, so
		// the queue is actually still full.
		return false
	}

	// The head slot is free, so we own it.
	// val=nil本身是用来表示空slot的，如果存入的是nil，需要用dequeueNil进行封装来区分
	// dequeueNil就是*struct{}
	if val == nil {
		val = dequeueNil(nil)
	}
	// 这里是个骚操作，注意eface的定义，跟interface底层的无接口方法的eface是不是很像
	// 直接将val转成interface，底层typ标注类型，val标注数据
	// 这也是为啥当存入的是nil的时候需要转成*struct{}，为了让typ不等于nil，从而不会被判定为是空slot
	*(*interface{})(unsafe.Pointer(slot)) = val

	// Increment head. This passes ownership of slot to popTail
	// and acts as a store barrier for writing the slot.
	// head+1
	atomic.AddUint64(&d.headTail, 1<<dequeueBits)
	return true
}

// popHead removes and returns the element at the head of the queue.
// It returns false if the queue is empty. It must only be called by a
// single producer.
// 从头部弹出对象
func (d *poolDequeue) popHead() (interface{}, bool) {
	var slot *eface
	for {
		ptrs := atomic.LoadUint64(&d.headTail)
		head, tail := d.unpack(ptrs)
		// 如果环队列是空的
		if tail == head {
			// Queue is empty.
			return nil, false
		}

		// Confirm tail and decrement head. We do this before
		// reading the value to take back ownership of this
		// slot.
		head--
		ptrs2 := d.pack(head, tail)
		// 这里是个原子操作，用来更新headTail
		if atomic.CompareAndSwapUint64(&d.headTail, ptrs, ptrs2) {
			// We successfully took back slot.
			// 如果更新成功
			// 获取对应的slot
			slot = &d.vals[head&uint32(len(d.vals)-1)]
			break
		}
		// 否则就重新再来一次
	}
	// 注意这里不同于pushHead，是先更新headTail再进行取操作，具体原因后面会说

	val := *(*interface{})(unsafe.Pointer(slot))
	// 如果是存入的是nil，解封装
	if val == dequeueNil(nil) {
		val = nil
	}
	// Zero the slot. Unlike popTail, this isn't racing with
	// pushHead, so we don't need to be careful here.
	// slot置空
	*slot = eface{}
	return val, true
}

// popTail removes and returns the element at the tail of the queue.
// It returns false if the queue is empty. It may be called by any
// number of consumers.
// 从尾部弹出对象
// 该方法只有在当前P被其他的P窃取对象时才会用，除了自身的并发竞争外还会跟上面的pushHead、popHead产生并发竞争
func (d *poolDequeue) popTail() (interface{}, bool) {
	var slot *eface
	for {
		// 这里操作跟popHead基本一样
		ptrs := atomic.LoadUint64(&d.headTail)
		head, tail := d.unpack(ptrs)
		if tail == head {
			// Queue is empty.
			return nil, false
		}

		// Confirm head and tail (for our speculative check
		// above) and increment tail. If this succeeds, then
		// we own the slot at tail.
		ptrs2 := d.pack(head, tail+1)
		// 也是原子操作，这里跟popHead中对headTail的原子操作天然形成了互斥
		// 也就是说popTail和popHead之间是无锁且并发安全的，同时也支持自身的并发安全
		if atomic.CompareAndSwapUint64(&d.headTail, ptrs, ptrs2) {
			// Success.
			slot = &d.vals[tail&uint32(len(d.vals)-1)]
			break
		}
	}

	// We now own slot.
	// 也是同样的操作
	val := *(*interface{})(unsafe.Pointer(slot))
	if val == dequeueNil(nil) {
		val = nil
	}

	// Tell pushHead that we're done with this slot. Zeroing the
	// slot is also important so we don't leave behind references
	// that could keep this object live longer than necessary.
	//
	// We write to val first and then publish that we're done with
	// this slot by atomically writing to typ.
	// 这里可能有人有疑问，为啥只对slot.typ进行原子操作
	// 主要吧slot是eface，两个unsafe.pointer，占用16字节，atomic还无法对16字节进行原子操作
	// 所以割了一半，只对slot.typ进行原子操作
	// 还记得pushHead中的typ := atomic.LoadPointer(&slot.typ)吧，跟这里是呼应的
	// 只有这里执行完后置slot.typ为nil，pushHead才能获得该slot进行后续操作
	// 所以这里又通过两个原子操作来解决了popTail和pushHead的并发问题
	slot.val = nil
	atomic.StorePointer(&slot.typ, nil)
	// At this point pushHead owns the slot.

	return val, true
}
``` 
### 总结
`sync.pool`的前几个版本还没有这么复杂，同样性能也比较差，后续迭代持续做了优化，下面说说`sync.pool`实现的一些亮点
 - 利用P的原生隔离属性，对缓存池进行分段，减少了锁粒度，降低了并发竞争的概率
 - 使用victim cache来进行缓存池的新老替换，实现了定期触发GC回收减少内存占用，也可作为二级缓存来增加命中率
 - 通过增加pad来避免cpu缓存的伪共享，提升读取性能
 - 底层存储使用eface结构体，方便进行判空和赋值(使用interface{})，并且环队列单节点使用固定2^n大小，方便通过mask计算存取位置，同时通过链表来实现扩容和收缩，然后定义通过定义头部存取和尾部取的行为来控制O(1)复杂度
 - 支持P之间共享分段池，通过限制其他P只能从尾部获取对象以及最小粒度的原子操作来实现了无锁共享
 - 环队列使用一个uint64的headTail来实现，通过位移操作来解出head和tail，方便进行原子操作，而且head和tail都是uint32，考虑溢出的话，逻辑上也是个环形结构，跟实际存储的环形结构保持一致，更方便计算位置索引