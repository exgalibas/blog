---
title: "Golang源码系列--ring"
author: "Joker"
pubDatetime: 2022-01-09T11:47:50+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang ring的实现源码解析"
---

### 概述
`go`中的`ring`实现了环形双向链表

### 源码解析
```go
// A Ring is an element of a circular list, or ring.
// Rings do not have a beginning or end; a pointer to any ring element
// serves as reference to the entire ring. Empty rings are represented
// as nil Ring pointers. The zero value for a Ring is a one-element
// ring with a nil Value.
// 链表节点结构，包括前后项指针和节点值
type Ring struct {
	next, prev *Ring
	Value      interface{} // for use by client; untouched by this library
}

// 初始化
// 注意这里没有初始化Value，此时Value == nil
func (r *Ring) init() *Ring {
	r.next = r
	r.prev = r
	return r
}

// Next returns the next ring element. r must not be empty.
// 获取后项节点
// 这里会判断r是否初始化过，始终会保证返回的*Ring不为nil
func (r *Ring) Next() *Ring {
	if r.next == nil {
		return r.init()
	}
	return r.next
}

// Prev returns the previous ring element. r must not be empty.
// 获取前项节点
// 这里会判断r是否初始化过，始终会保证返回的*Ring不为nil
func (r *Ring) Prev() *Ring {
	if r.next == nil {
		return r.init()
	}
	return r.prev
}

// Move moves n % r.Len() elements backward (n < 0) or forward (n >= 0)
// in the ring and returns that ring element. r must not be empty.
// 获取向前/向后的第x个节点，其中x = n % r.Len()
func (r *Ring) Move(n int) *Ring {
    // 如果r没有初始化则初始化，且对于只有一个节点的环链表，前后第x个节点都是自己
	if r.next == nil {
		return r.init()
	}
	switch {
    // n < 0 表示向前
	case n < 0:
		for ; n < 0; n++ {
			r = r.prev
		}
    // n > 0 表示向后
	case n > 0:
		for ; n > 0; n-- {
			r = r.next
		}
	}
	return r
}

// New creates a ring of n elements.
// 构建包含n个节点的环链表
// 注意新建后的所有节点的Value == nil
func New(n int) *Ring {
	if n <= 0 {
		return nil
	}
	r := new(Ring)
	p := r
	for i := 1; i < n; i++ {
		p.next = &Ring{prev: p}
		p = p.next
	}
	p.next = r
	r.prev = p
	return r
}

// Link connects ring r with ring s such that r.Next()
// becomes s and returns the original value for r.Next().
// r must not be empty.
//
// If r and s point to the same ring, linking
// them removes the elements between r and s from the ring.
// The removed elements form a subring and the result is a
// reference to that subring (if no elements were removed,
// the result is still the original value for r.Next(),
// and not nil).
//
// If r and s point to different rings, linking
// them creates a single ring with the elements of s inserted
// after r. The result points to the element following the
// last element of s after insertion.
// 连接两个环
// 如果是同一个环，则可能会删除部分节点
func (r *Ring) Link(s *Ring) *Ring {
    // 获取r的后项节点，这里会检查是否初始化
	n := r.Next()
	if s != nil {
        // 获得s的前项节点，这里会检查是否初始化
		p := s.Prev()
		// Note: Cannot use multiple assignment because
		// evaluation order of LHS is not specified.
        // 切掉r和r.next的连接，让r和s连接上
		r.next = s
        // 切掉s和s.prev的连接，让s和r连接上
		s.prev = r
        // 让r的后项节点和s的前项节点连接上
        // 这里如果r和s是同一个环链接的话，r和s中间的所有节点都会被切掉
        // 如果r和s是同一节点，那么最后就只剩r一个节点了
		n.prev = p
		p.next = n
	}
	return n
}

// Unlink removes n % r.Len() elements from the ring r, starting
// at r.Next(). If n % r.Len() == 0, r remains unchanged.
// The result is the removed subring. r must not be empty.
// 删除自r为起点后的x个节点，其中x = n % r.Len()
func (r *Ring) Unlink(n int) *Ring {
	if n <= 0 {
		return nil
	}
    // 注意这里需要n+1，因为Link删除的是节点r 和 节点r+n+1之间的所有节点，也就是 r+n+1 - r - 1 = n 个节点
	return r.Link(r.Move(n + 1))
}

// Len computes the number of elements in ring r.
// It executes in time proportional to the number of elements.
// 获取环链表的长度
func (r *Ring) Len() int {
	n := 0
	if r != nil {
		n = 1
        // 注意这里只能通过p != r来判断是否遍历结束，因为是环形的
		for p := r.Next(); p != r; p = p.next {
			n++
		}
	}
	return n
}

// Do calls function f on each element of the ring, in forward order.
// The behavior of Do is undefined if f changes *r.
// 遍历所有节点，并使用Value作为参数执行f方法
// 注意该方法中涉及到遍历环链表，如果f方法对环链表进行了变更，后果将是不可预期的
func (r *Ring) Do(f func(interface{})) {
	if r != nil {
		f(r.Value)
		for p := r.Next(); p != r; p = p.next {
			f(p.Value)
		}
	}
}
```

### 举个栗子
```go
func p(r *ring.Ring) {
	if r == nil {
		fmt.Println("nil")
		return
	}

	fmt.Printf("%d ->", r.Value.(int))
	p := r.Next()
	for ; p != r; p = p.Next() {
		fmt.Printf("%d ->", p.Value.(int))
	}
	fmt.Println("")
}

func main() {
	r := ring.New(5)
	n := r.Len()

	for i := 0; i < n; i++ {
		r.Value = i
		r = r.Next()
	}
	p(r) // 0 ->1 ->2 ->3 ->4 ->
	r = r.Move(2)
	p(r) // 2 ->3 ->4 ->0 ->1 ->
	r = r.Move(-1)
	p(r) // 1 ->2 ->3 ->4 ->0 ->
	r1 := r.Move(3)
	p(r1) // 4 ->0 ->1 ->2 ->3 ->
	r.Link(r1)
	p(r) // 1 ->4 ->0 ->
	r.Unlink(1)
	p(r) // 1 ->0 ->

    // 因为调用了r.Unlink(1)，只输出了1
    // 方法中切记谨慎操作r，可能导致死循环等意外的结果   
	r.Do(func(i interface{}) {
		fmt.Println(i.(int))  // 1
		r.Unlink(1)
	})
}
```

### 总结
别的不说，`Link`方法可谓精妙，包含了向后插入新节点、合并两个环形链表和删除链表部分节点三个功能，而且结合`Prev`方法也能做到向前插入节点，唯一不过瘾的地方就是没法像`list`那样，插入节点的同时进行`Value`的初始化，只能自己先初始化`Ring`节点，使用场景上，`ring`可以作为可覆盖的热缓存使用，比如存储最新的N个订单，类似innodb的redo log