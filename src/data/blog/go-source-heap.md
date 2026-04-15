---
title: "Golang源码系列--heap"
author: "Joker"
pubDatetime: 2022-01-08T17:41:12+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang heap的实现源码解析"
---

### 概述
`go`的`heap`实现了堆，关于堆可以看下[数据结构：堆（Heap）](https://www.jianshu.com/p/6b526aa481b1)，这里就不阐述了，go实现的源码在`container/heap/heap.go`中，其中包含了1个接口，5个外部方法和2个内部方法

### 接口
```go
type Interface interface {
	sort.Interface
	Push(x interface{}) // add x as element Len()
	Pop() interface{}   // remove and return element Len() - 1.
}

// 其中sort.Interface的定义如下
type Interface interface {
	// Len is the number of elements in the collection.
	Len() int
	// Less reports whether the element with
	// index i should sort before the element with index j.
	Less(i, j int) bool
	// Swap swaps the elements with indexes i and j.
	Swap(i, j int)
}
```
也就是说，要使用`heap`，需要自己实现`heap.Interface`接口，并不是开箱即用的，除了`Less`方法，其他的都能根据方法名推出功能，`Less`方法返回`bool`类型，典型的实现就是两个元素的比较，通过更改比较规则，我们可以很方便的实现最大堆和最小堆

### 内部方法
```go
// 这是个典型的堆向下追溯的过程
func down(h Interface, i0, n int) bool {
	i := i0
	for {
        // 先找左节点，如果左节点不存在，那右节点更不可能存在了，直接break跳出即可
		j1 := 2*i + 1
		if j1 >= n || j1 < 0 { // j1 < 0 after int overflow
			break
		}
		j := j1 // left child
        // 再找右节点，满足右节点存在且跟左节点比较符合自定义的Less方法的预期，即返回true，就让右节点去跟父节点比较
		if j2 := j1 + 1; j2 < n && h.Less(j2, j1) {
			j = j2 // = 2*i + 2  // right child
		}
        // 假设这里是找最小堆
        // min(左节点, 右节点) 再跟父节点比较，如果比父节点大，那就不用调换，直接退出即可
		if !h.Less(j, i) {
			break
		}
        // 调换父节点和min(左节点, 右节点)
		h.Swap(i, j)
        // 一旦发生了调换，那么肯定有某个子节点发生了变更，需要以该字节为父节点，重复上述操作直到未发生调换行为或者追溯到了叶子节点
		i = j
	}
    // 只要发生调换，那么i就不会再等于i0，这里是通过这个来标记整个追溯过程是否发生了父子节点的调换 
	return i > i0
}

// 堆向上追溯的过程
func up(h Interface, j int) {
	for {
        // 找到j对应节点的父节点，下面简称为j节点
		i := (j - 1) / 2 // parent
        // 如果j节点就是根节点或者j节点和父节点不满足Less方法的预期，即返回false，不用进行调换，直接退出即可
		if i == j || !h.Less(j, i) {
			break
		}
        // 调换j节点和父节点
		h.Swap(i, j)
        // 同样的一旦发生了调换，那么父节点肯定就发生了变更，需要以父节点作为子节点，重复上诉操作直到未发生调换行为或者追溯到了根节点
		j = i
	}
}
```
`down`和`up`，根据自定义的`Less`和`Swap`方法进行比较和调换，一个实现向下追溯，一个实现向上追溯，最终目的是为了保证每一个父节点、左子节点和右子节点的三元组满足 `父节点 <=/>= min/max(左子节点，右子节点)`

### 外部方法
```go
// 初始化堆，构建完全二叉树
func Init(h Interface) {
	// heapify
	n := h.Len()
    // 倒序从第一个非叶子节点开始遍历，如果只有根节点一个节点，则不会执行，不满足 i >= 0
    // 为什么n/2 - 1是倒序第一个非叶子节点呢？
    // 还记得吗，堆是以完全二叉树为逻辑结构的
    // 那么假设有x个非叶子节点(x > 1)，那么节点总数有两种情况
    // 一种是最后一个非叶子节点有两个儿子节点，即2*x+1 (这个1是根节点自己)
    // 另外一个情况是最后一个非叶子节点只有一个儿子节点，即(x-1)*2+1+1 = 2*x
    // 因为n = 2*x+1 或者 n = 2*x，所以x = n/2，又因为这里使用的是索引下标，所以n/2-1是倒序第一个非叶子节点
    // 倒序保证每一个非叶子节点作为根节点的树都是最大/小堆，以此类推到根节点，就能保证整个树就是最大/最小堆 
	for i := n/2 - 1; i >= 0; i-- {
		down(h, i, n)
	}
}

// 添加元素
func Push(h Interface, x interface{}) {
    // 自定义方法
	h.Push(x)
    // 注意Push的前提是已经调用了Init方法进行了初始化
    // 这里默认添加入的元素是在尾部，所以自定义的Push方法需要注意下，别跟栈一样从顶部push
    // 因为已经是最大/最小堆了，所以只需要调用up方法，针对最末尾的节点进行向上追溯即可 
	up(h, h.Len()-1)
}

// 弹出最大/最小元素
func Pop(h Interface) interface{} {
    // 获取最末尾元素的索引
	n := h.Len() - 1
    // 将首尾元素调换，这里首位元素就是最大/最小值，是需要被pop出去的
	h.Swap(0, n)
    // 因为根节点即首位元素发生了变化，所以需要调用down方法进行向下追溯
    // 注意这里的n不是h.Len()，而是h.Len() - 1，因为有pop动作，新的长度会减1
	down(h, 0, n)
    // 这里默认是从尾部弹出，自定义实现的时候需要注意一下，别跟栈一样从顶部弹出了
	return h.Pop()
}

// 移除某个元素
func Remove(h Interface, i int) interface{} {
    // 获取最末尾元素的索引
	n := h.Len() - 1
    // 如果移除的元素不是末尾元素
	if n != i {
        // 调换节点i和节点n
 		h.Swap(i, n)
        // 调用down方法进行向下追溯，这里n也是h.Len() - 1，原因同上
        // 如果向下追溯过程中发生了调换，就不用再调用向上追溯了，因为节点i的子节点都比节点i小/大(针对最大堆和最小堆)
		if !down(h, i, n) {
			up(h, i)
		}
	}
    // 弹出末尾元素
	return h.Pop()
}

// 针对某个节点i，发起堆修复操作
// 比如更改了某个节点的值，就需要重新维护
func Fix(h Interface, i int) {
    // 这里跟Remove方法中的操作基本一样，就是分别向下向上追溯的过程，不再细说
	if !down(h, i, h.Len()) {
		up(h, i)
	}
}
```

### 举个栗子
源码分析的差不多了，下面来看下应用
```go
type hs []int

func (recv hs) Less(i, j int) bool {
	return recv[i] < recv[j]
}

func (recv hs) Len() int {
	return len(recv)
}

func (recv hs) Swap(i, j int) {
	recv[i], recv[j] = recv[j], recv[i]
}

func (recv *hs) Push(x interface{}) {
	item := x.(int)
	*recv = append(*recv, item)
}

func (recv *hs) Pop() interface{} {
	l := len(*recv) - 1
	item := (*recv)[l]
	*recv = (*recv)[:l]
	return item
}

func main()  {

	var hp hs = []int{4,2,3,7,5,1,5,3,8,9,3,2,0}
	hpPtr := &hp
	fmt.Println(hp.Less(0, 1)) // false
	fmt.Println(hp.Len()) // 13
	hp.Swap(2, 3)
	fmt.Println(hp) // [4 2 7 3 5 1 5 3 8 9 3 2 0]
	hpPtr.Push(11)
	fmt.Println(hp) // [4 2 7 3 5 1 5 3 8 9 3 2 0 11]
	hpPtr.Pop()
	fmt.Println(hp) // [4 2 7 3 5 1 5 3 8 9 3 2 0]

	heap.Init(hpPtr)
	fmt.Println(hp) // [0 2 1 3 3 2 5 3 8 9 5 4 7]
	fmt.Println(heap.Pop(hpPtr)) // 0
	heap.Push(hpPtr, -1) 
	fmt.Println(hp) // [-1 2 1 3 3 2 5 3 8 9 5 7 4]
	heap.Remove(hpPtr, 0)
	fmt.Println(hp) // [1 2 2 3 3 4 5 3 8 9 5 7]
	hp[3] = -1
	fmt.Println(hp) // [1 2 2 -1 3 4 5 3 8 9 5 7]
	heap.Fix(hpPtr, 3)
	fmt.Println(hp) // [-1 1 2 2 3 4 5 3 8 9 5 7]
}
```

### 总结
`heap`个人感觉是一个工具类的半成品吧，做不到开箱即用，而且使用者需要对`heap`的实现比较了解，否则可能容易踩坑，比如上面说到的，`heap`中`Pop`方法默认弹出末位元素，`Less`方法如何实现才能控制最大/小堆等等，而且使用其他方法之前必须先调用`Init`方法，否则结果可能是非预期的，这点`heap`里面也没有进行限制，最后建议如果使用heap，最好跟上面例子一样使用slice进行包装，这样接入的成本是最低的