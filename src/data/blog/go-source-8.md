---
title: "Golang源码系列--sync.map"
author: "Joker"
pubDatetime: 2019-04-02T21:15:10+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang sync.map的实现源码解析"
---

### 原生的map
`go`中原生的`map`不是线程安全的，并发情况下会报错，如下
```go
package main

func main() {
	m := make(map[int]int)
	go func() {
		for {
			_ = m[1]
		}
	}()
	go func() {
			m[2] = 2
	}()
	select {}
}

// output
fatal error: concurrent map read and map write
```
并发读和写就会报上面的问题，哪怕是多读一写

### Sync.Map
`sync.map`实现了可并发读写的map，内部通过两个map(read map 和 dirty map)来实现，当然也可以粗暴的加锁，高并发下锁的争抢带来性能影响，而且map的使用场景一般都是多读少写，应该在写的同时尽可能的不阻塞读，`sync.map`就实现了这点

### Struct
```go
type Map struct {
    // 锁，写dirty map的时候需要
	mu Mutex
    // read map，根据sync.value的特性，可以在无锁情况下支持并发读写 
	read atomic.Value // readOnly
    // dirty map，每次需要加锁，直接map类型就行了，不用跟read map一样搞一层value包着
	dirty map[interface{}]*entry
    // 每次读取read map miss的次数
	misses int
}

// map.read 实际存的结构
type readOnly struct {
    // 实际的read map
	m       map[interface{}]*entry
    // 标记dirty map中是否有m中没有的key，true有/false没有 
	amended bool
}

// dirty map删除标志位
// 这个标志位设计的很巧妙，后面再看
var expunged = unsafe.Pointer(new(interface{})) 

// read map 和 dirty map共享的value节点
// 因为map的相关操作会涉及到read map 和 dirty map的相互复制，节点共享可以节省内存
type entry struct {
    // 直接定义成unsafe.Pointer，方便进行atomic相关操作
	p unsafe.Pointer
}
```

### Delete
先看简单的`delete`
```go
func (m *Map) Delete(key interface{}) {
	read, _ := m.read.Load().(readOnly) // sync.value.load方法获取read map
	e, ok := read.m[key]  // 获取对应节点
	if !ok && read.amended {  // read map中没有，且amended为true，那可能在dirty表中有
        // 这里加锁后还需要再检查一次，因为if判断和加锁操作并非原子操作
        // 这里没有把锁放到if判断的外面，也是尽量减少锁的范围
		m.mu.Lock()
		read, _ = m.read.Load().(readOnly)
		e, ok = read.m[key]
		if !ok && read.amended {
			delete(m.dirty, key)  // 不管dirty map有没有，直接delete就完事了
		}
		m.mu.Unlock()
	}
	if ok {
		e.delete()   // read map有的话，不要动dirty map，因为动dirty map是有锁的代价的
	}
}

func (e *entry) delete() (hadValue bool) {
	for {
		p := atomic.LoadPointer(&e.p)  // 原子取p的值

        // 注意这里p的类型是unsafe.Pointer，也就是*ArbitraryType 是一指针类型
        // 所以p == nil 不等于你设置的value == nil，我看的时候就陷进去了。。。
        // 对于read map，p == nil 表示仅仅在read map中删掉了该key
        // 而p == expunged 则表示read map 和 dirty map 都删掉了该key
		if p == nil || p == expunged {
			return false
		}
        // 原子替换p的值为nil，也就是删掉read map中对应的key
		if atomic.CompareAndSwapPointer(&e.p, p, nil) {
			return true
		}
	}
}
```
### Load
再看复杂点的`load`
```go
func (m *Map) Load(key interface{}) (value interface{}, ok bool) {
	read, _ := m.read.Load().(readOnly)
	e, ok := read.m[key]
	if !ok && read.amended { // read map中没有且amended为true，到dirty map 瞅瞅
		m.mu.Lock()  // 上锁
        // 这里也是双重检查
		read, _ = m.read.Load().(readOnly)
		e, ok = read.m[key]
		if !ok && read.amended {
			e, ok = m.dirty[key]
			m.missLocked()   // 触发miss逻辑
		}
		m.mu.Unlock()
	}
	if !ok {   // 两个map 都没有
		return nil, false
	}
	return e.load()   // 处理并返回真实存储的value entry.p
}

func (m *Map) missLocked() {
	m.misses++   // 不管dirty map 中有没有找到，miss都加一
	if m.misses < len(m.dirty) {  // 没触发覆盖
		return
	}

    // 触发覆盖，将dirty map 覆盖 read map，并设置amended为false
    // 因为多次触发读穿透read map 到 dirty map可以认为dirty map 比 read map的key多到一定程度，避免穿透频率过大导致性能下降
	m.read.Store(readOnly{m: m.dirty})
    // dirty map 置为nil，节约内存
	m.dirty = nil
    // miss计数归零 
	m.misses = 0
}

func (e *entry) load() (value interface{}, ok bool) {
	p := atomic.LoadPointer(&e.p) 
	if p == nil || p == expunged { // entry对应的key被read map删掉了
		return nil, false
	}
	return *(*interface{})(p), true 
}
```

### Store
最后看看`store`
```go
func (m *Map) Store(key, value interface{}) {
	read, _ := m.read.Load().(readOnly)
	if e, ok := read.m[key]; ok && e.tryStore(&value) { // 如果read map中有，尝试直接存到read map中(sync.value的store多方便啊，还不需要锁)
		return
	}

	m.mu.Lock()  // 开始找dirty map搞事情了，必加锁
	read, _ = m.read.Load().(readOnly)
	if e, ok := read.m[key]; ok {   // read map中有，但是被标记成expunged，表示已经key已经从dirty map中删除掉了，需要再加上
		if e.unexpungeLocked() {
			m.dirty[key] = e  // dirty map加上key，与read map共享e
		}
		e.storeLocked(&value)  // 存储value到e
	} else if e, ok := m.dirty[key]; ok { // read map中没有，但是dirty map中有
		e.storeLocked(&value) // 直接存
	} else { // 两个map 中都没有，新的节点
		if !read.amended {  // 如果dirty map对比read map没有多余的节点，有可能被置为空了，需要触发初始化
			m.dirtyLocked() // 初始化
			m.read.Store(readOnly{m: read.m, amended: true}) // 设置read map的amended
		}
		m.dirty[key] = newEntry(value) // dirty map 新增节点
	}
	m.mu.Unlock()
}

func (e *entry) tryStore(i *interface{}) bool {
	p := atomic.LoadPointer(&e.p)
	if p == expunged {  // 如果该节点在dirty map中也被删了，那可不能仅仅存到read map
		return false
	}
	for {
		if atomic.CompareAndSwapPointer(&e.p, p, unsafe.Pointer(i)) { // 原子存储
			return true
		}
                
        // 存失败了，重新获得p，重新判断
		p = atomic.LoadPointer(&e.p)
		if p == expunged {
			return false
		}
	}
}

func (e *entry) unexpungeLocked() (wasExpunged bool) {
	return atomic.CompareAndSwapPointer(&e.p, expunged, nil) // 原子操作，判断原值是否是expunged，并用nil进行替换
}

func (e *entry) storeLocked(i *interface{}) {
	atomic.StorePointer(&e.p, unsafe.Pointer(i)) // 原子存储
}

func (m *Map) dirtyLocked() {
	if m.dirty != nil {   // dirty map不为nil，不触发初始化
		return
	}

	read, _ := m.read.Load().(readOnly)
	m.dirty = make(map[interface{}]*entry, len(read.m))  // 初始化dirty map
    // 将read map 复制到 dirty map
	for k, e := range read.m {
        // 这里先将read map中被删除的节点，即entry.p为nil的节点设置为expunged，表示从dirty map 中也删除该节点
		if !e.tryExpungeLocked() { 
			m.dirty[k] = e
		}
	}
}

func (e *entry) tryExpungeLocked() (isExpunged bool) {
	p := atomic.LoadPointer(&e.p)
	for p == nil {
		if atomic.CompareAndSwapPointer(&e.p, nil, expunged) { // 原子操作，设置e.p 为expunged
			return true
		}
		p = atomic.LoadPointer(&e.p)
	}
	return p == expunged
}
```

### 总结
`sync.map`中有几个巧妙的地方
 - 通过read map 和  dirty map 进行读写分离，避免频繁使用锁
 - 底层通过struct entry来实现两个map的数据共享
 - 通过nil和expunged来标记entry.p来区分read map删除和dirty map删除，nil标记实现减少dirty map的写操作，expunged标记实现释放无效内存占用
 - 动态调整，miss多次后，将dirty map升级为read map，避免多次穿透加锁
 - 双重检测，减少锁范围