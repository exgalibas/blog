---
title: "Golang源码系列--list"
author: "Joker"
pubDatetime: 2022-01-08T21:03:20+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang list的实现源码解析"
---

### 概述
`go`的`list`实现了双向链表

### 源码解析
```go
// Element is an element of a linked list.
// 定义链表节点结构体
type Element struct {
	// Next and previous pointers in the doubly-linked list of elements.
	// To simplify the implementation, internally a list l is implemented
	// as a ring, such that &l.root is both the next element of the last
	// list element (l.Back()) and the previous element of the first list
	// element (l.Front()).
    // 前项指针和后项指针 
	next, prev *Element

	// The list to which this element belongs.
    // 所属的链表
	list *List

	// The value stored with this element.
    // 节点值
	Value interface{}
}

// Next returns the next list element or nil.
// 获取后项节点
func (e *Element) Next() *Element {
    // 这里会规避掉root节点，因为list的root节点只是个起始标记，不存才任何数据
	if p := e.next; e.list != nil && p != &e.list.root {
		return p
	}
	return nil
}

// Prev returns the previous list element or nil.
// 获取前项节点
func (e *Element) Prev() *Element {
    // 因为是双向链表，所以向后获取也可能获取到root节点，也需要规避
	if p := e.prev; e.list != nil && p != &e.list.root {
		return p
	}
	return nil
}

// List represents a doubly linked list.
// The zero value for List is an empty list ready to use.
type List struct {
    // 头节点，不存数据，只做头部标识
	root Element // sentinel list element, only &root, root.prev, and root.next are used
    // 链表长度
	len  int     // current list length excluding (this) sentinel element
}

// Init initializes or clears list l.
// 链表初始化
func (l *List) Init() *List {
	l.root.next = &l.root
	l.root.prev = &l.root
	l.len = 0
	return l
}

// New returns an initialized list.
func New() *List { return new(List).Init() }

// Len returns the number of elements of list l.
// The complexity is O(1).
func (l *List) Len() int { return l.len }

// Front returns the first element of list l or nil if the list is empty.
// 获取链表的第一个节点
func (l *List) Front() *Element {
	if l.len == 0 {
		return nil
	}
	return l.root.next
}

// Back returns the last element of list l or nil if the list is empty.
// 获取链表的最后一个节点
func (l *List) Back() *Element {
	if l.len == 0 {
		return nil
	}
	return l.root.prev
}

// lazyInit lazily initializes a zero List value.
// 延迟初始化
func (l *List) lazyInit() {
    // 这里用l.root.next作为判断是否初始化的依据而不是l.len，因为即使初始化过的l，l.len也有可能为0
	if l.root.next == nil {
		l.Init()
	}
}

// insert inserts e after at, increments l.len, and returns e.
// 在at节点之后插入e节点
func (l *List) insert(e, at *Element) *Element {
	e.prev = at
	e.next = at.next
	e.prev.next = e
	e.next.prev = e
	e.list = l
	l.len++
	return e
}

// insertValue is a convenience wrapper for insert(&Element{Value: v}, at).
func (l *List) insertValue(v interface{}, at *Element) *Element {
	return l.insert(&Element{Value: v}, at)
}

// remove removes e from its list, decrements l.len, and returns e.
// 从链表中删除e节点
func (l *List) remove(e *Element) *Element {
	e.prev.next = e.next
	e.next.prev = e.prev
	e.next = nil // avoid memory leaks
	e.prev = nil // avoid memory leaks
	e.list = nil
	l.len--
	return e
}

// move moves e to next to at and returns e.
// 将e节点挪到at节点的后面
func (l *List) move(e, at *Element) *Element {
	if e == at {
		return e
	}
	e.prev.next = e.next
	e.next.prev = e.prev

	e.prev = at
	e.next = at.next
	e.prev.next = e
	e.next.prev = e

	return e
}

// Remove removes e from l if e is an element of list l.
// It returns the element value e.Value.
// The element must not be nil.
func (l *List) Remove(e *Element) interface{} {
    // 这里隐含了双重判断，第一是判断l是否初始化过，第二是判断e是否是l上的节点
	if e.list == l {
		// if e.list == l, l must have been initialized when e was inserted
		// in l or l == nil (e is a zero Element) and l.remove will crash
		l.remove(e)
	}
	return e.Value
}

// PushFront inserts a new element e with value v at the front of list l and returns e.
func (l *List) PushFront(v interface{}) *Element {
    // 延迟初始化，这里会保证l已经初始化过了
    // 这也是为什么上面Remove方法可以通过e.list == l来做两重判断
	l.lazyInit()
	return l.insertValue(v, &l.root)
}

// PushBack inserts a new element e with value v at the back of list l and returns e.
func (l *List) PushBack(v interface{}) *Element {
	l.lazyInit()
	return l.insertValue(v, l.root.prev)
}

// InsertBefore inserts a new element e with value v immediately before mark and returns e.
// If mark is not an element of l, the list is not modified.
// The mark must not be nil.
func (l *List) InsertBefore(v interface{}, mark *Element) *Element {
    // 同Remove
	if mark.list != l {
		return nil
	}
	// see comment in List.Remove about initialization of l
	return l.insertValue(v, mark.prev)
}

// InsertAfter inserts a new element e with value v immediately after mark and returns e.
// If mark is not an element of l, the list is not modified.
// The mark must not be nil.
func (l *List) InsertAfter(v interface{}, mark *Element) *Element {
	if mark.list != l {
		return nil
	}
	// see comment in List.Remove about initialization of l
	return l.insertValue(v, mark)
}

// MoveToFront moves element e to the front of list l.
// If e is not an element of l, the list is not modified.
// The element must not be nil.
func (l *List) MoveToFront(e *Element) {
	if e.list != l || l.root.next == e {
		return
	}
	// see comment in List.Remove about initialization of l
	l.move(e, &l.root)
}

// MoveToBack moves element e to the back of list l.
// If e is not an element of l, the list is not modified.
// The element must not be nil.
func (l *List) MoveToBack(e *Element) {
	if e.list != l || l.root.prev == e {
		return
	}
	// see comment in List.Remove about initialization of l
	l.move(e, l.root.prev)
}

// MoveBefore moves element e to its new position before mark.
// If e or mark is not an element of l, or e == mark, the list is not modified.
// The element and mark must not be nil.
func (l *List) MoveBefore(e, mark *Element) {
	if e.list != l || e == mark || mark.list != l {
		return
	}
	l.move(e, mark.prev)
}

// MoveAfter moves element e to its new position after mark.
// If e or mark is not an element of l, or e == mark, the list is not modified.
// The element and mark must not be nil.
func (l *List) MoveAfter(e, mark *Element) {
	if e.list != l || e == mark || mark.list != l {
		return
	}
	l.move(e, mark)
}

// PushBackList inserts a copy of another list at the back of list l.
// The lists l and other may be the same. They must not be nil.
// 将链表other连接到l后面
func (l *List) PushBackList(other *List) {
	l.lazyInit()
	for i, e := other.Len(), other.Front(); i > 0; i, e = i-1, e.Next() {
		l.insertValue(e.Value, l.root.prev)
	}
}

// PushFrontList inserts a copy of another list at the front of list l.
// The lists l and other may be the same. They must not be nil.
// 将链表l连接到other后面，root节点不变
func (l *List) PushFrontList(other *List) {
	l.lazyInit()
	for i, e := other.Len(), other.Back(); i > 0; i, e = i-1, e.Prev() {
		l.insertValue(e.Value, &l.root)
	}
}

```

### 举个栗子
```go
func main()  {

	l := list.New()
	l.PushFront(1)
	e := l.PushBack(4)
	e = l.InsertBefore(2, e)
	l.InsertAfter(3, e)
	p(l) // 1 ->2 ->3 ->4 ->

	front := l.Front()
	back := l.Back()
	l.MoveToBack(front)
	p(l) // 2 ->3 ->4 ->1 ->
	l.MoveToFront(back)
	p(l) // 4 ->2 ->3 ->1 ->
	l.Remove(front)
	p(l) // 4 ->2 ->3 ->

	l1 := list.New()
	l1.PushBack(5)
	l1.PushBack(6)

	l.PushBackList(l1)
	p(l) // 4 ->2 ->3 ->5 ->6 ->
	l.PushFrontList(l1)
	p(l) // 5 ->6 ->4 ->2 ->3 ->5 ->6 ->
	l1.PushBackList(l1)
	p(l1) // 5 ->6 ->5 ->6 ->
}

func p(l *list.List) {
	e := l.Front()
	for e != nil {
		fmt.Printf("%d ->", e.Value.(int))
		e = e.Next()
	}
	fmt.Println("")
}
```

### 总结
`list`通过构造root标识节点，实现了双向链，快速的找到front和last数据节点，且在节点的插入，移动等操作中，对于头尾的位置，不需要做特殊的判断，很好的兼容统一处理逻辑，同时节点结构体包含了其所属链表，不仅可以用来做双重判断，还能增加安全性，不过，这个对于两个链表连接的操作不太友好，需要每次都进行节点复制