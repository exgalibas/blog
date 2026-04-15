---
title: "Golang源码系列--value"
author: "Joker"
pubDatetime: 2019-03-31T23:09:48+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang value的实现源码解析"
---

### 概述
`atomic.Value`支持不用锁的情况下并发读写"任意类型"数据

### 前置知识
 - interface底层结构 https://i6448038.github.io/2018/10/01/Golang-interface/
 - unsafe https://gocn.vip/question/371

### example
```go
package main

import (
	"sync/atomic"
	"fmt"
)

func main() {
	var v atomic.Value
	v.Store("joker")
	fmt.Println(v.Load())    // joker
	v.Store(1)
	fmt.Println(v.Load())  // panic: sync/atomic: store of inconsistently typed value into Value
}
```
对于`v.Store("joker")`触发第一次写入，类型就固定为string了，后面的`v.Store(1)`尝试写入`int`类型报错，这也是概述里对任意类型加引号的原因

### Struct
```go
type Value struct {
	v interface{}  // 这里用interface{}类型就是为了支持写任意类型
}

// ifaceWords 就是 interface{} 的内部结构 eface
// 这里引入是为了能拆解Value.v的类型和值，方便进行判断和存储
type ifaceWords struct {
	typ  unsafe.Pointer
	data unsafe.Pointer
}
```

### Store
#### 原型
```go
func (v *Value) Store(x interface{})
```
#### 源码
```go
func (v *Value) Store(x interface{}) {
	if x == nil {
		panic("sync/atomic: store of nil value into Value")
	}
	vp := (*ifaceWords)(unsafe.Pointer(v))  // 拆解v的类型和值
	xp := (*ifaceWords)(unsafe.Pointer(&x))  // 拆解x的类型和值
	for {
		typ := LoadPointer(&vp.typ)  // 原子载入v的类型
		if typ == nil {  // 初次写入
			runtime_procPin()  // 这个不知道干嘛滴
			if !CompareAndSwapPointer(&vp.typ, nil, unsafe.Pointer(^uintptr(0))) {   // 设置正在初次写入标志
				runtime_procUnpin() // 这个也不知道干嘛滴
				continue
			}
			StorePointer(&vp.data, xp.data) // 写入x的类型
			StorePointer(&vp.typ, xp.typ)  // 写入x的值
			runtime_procUnpin()
			return
		}
		if uintptr(typ) == ^uintptr(0) {
			// 这里检查是否有别的go正在进行初次写入
			continue
		}
		if typ != xp.typ {  // 检查后续的写入和初次写入的数据的类型是否一致
			panic("sync/atomic: store of inconsistently typed value into Value")
		}
		StorePointer(&vp.data, xp.data)  // 写入x的值
		return
	}
}
```
为什么需要设定一个写入标志位呢，因为每次的写入都是分类型写入和值写入，虽然各自都是原子写入，但是分两步执行在并发的时候就会有ABA的问题，所以需要设定一个标志位，类似锁的效果吧

### Load
#### 原型
```go
func (v *Value) Load() (x interface{})
```

#### 源码
```go
func (v *Value) Load() (x interface{}) {
	vp := (*ifaceWords)(unsafe.Pointer(v))
	typ := LoadPointer(&vp.typ)  // 获得已写入数据的类型
	if typ == nil || uintptr(typ) == ^uintptr(0) {
		// 如果还没有写入或者正在写入
		return nil
	}
	data := LoadPointer(&vp.data) // 获得已写入数据的值
	xp := (*ifaceWords)(unsafe.Pointer(&x)) // 拆解x并分别写入值和类型
	xp.typ = typ
	xp.data = data
	return
}
```

### 总结
不得不说，unsafe真的好用，各种越过go的类型系统，不过越好用的东西越要谨慎