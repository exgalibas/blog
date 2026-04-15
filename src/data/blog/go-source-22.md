---
title: "Golang源码系列--slice"
author: "Joker"
pubDatetime: 2022-02-23T11:16:24+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang slice的实现源码解析"
---

### 概述
slice中文切片的意思，是go独有的类型，底层是数组，可以很方便的进行截取，也支持扩容、拷贝操作

### 结构
```go
type slice struct {
 	// 指向底层数组的指针
	array unsafe.Pointer
	// 切片的长度
	len   int
	// 切片的容量
	cap   int
}
```

### 创建
```go
// 新建一个tolen长度的slice，并从from中的fromlen个元素copy到新建的slice
// 如果tolen < fromlen，则只copy tolen个元素
func makeslicecopy(et *_type, tolen int, fromlen int, from unsafe.Pointer) unsafe.Pointer {
	var tomem, copymem uintptr
	// 如果新建的slice长度比要拷贝的长度大
	if uintptr(tolen) > uintptr(fromlen) {
		var overflow bool
		// 判断是否会溢出
		tomem, overflow = math.MulUintptr(et.size, uintptr(tolen))
		if overflow || tomem > maxAlloc || tolen < 0 {
			panicmakeslicelen()
		}
		// 那么拷贝长度按照fromlen来计算
		// 这里计算的是字节数
		copymem = et.size * uintptr(fromlen)
	} else {
		// fromlen is a known good length providing and equal or greater than tolen,
		// thereby making tolen a good slice length too as from and to slices have the
		// same element width.
		// 否则拷贝长度按照tolen来计算
		tomem = et.size * uintptr(tolen)
		copymem = tomem
	}

	var to unsafe.Pointer
	// 下面是通过mallocgc来申请内存
	// 区分slice元素类型是否是指针类型
	if et.ptrdata == 0 {
		// 如果非指针，直接申请字节流
		to = mallocgc(tomem, nil, false)
		// 并将copy之后多余的部分清零
		if copymem < tomem {
			memclrNoHeapPointers(add(to, copymem), tomem-copymem)
		}
	} else {
		// Note: can't use rawmem (which avoids zeroing of memory), because then GC can scan uninitialized memory.
		// 否则需要按类型申请，因为mallocgc会根据et来判断是否需要按照有指针处理
		to = mallocgc(tomem, et, true)
		if copymem > 0 && writeBarrier.enabled {
			// Only shade the pointers in old.array since we know the destination slice to
			// only contains nil pointers because it has been cleared during alloc.
			// 由于GC的存在, 在拷贝前, 如果et包含指针, 需要开启写屏障
			// 关于写屏障，可以看下 https://www.jianshu.com/p/64240319ed60
			bulkBarrierPreWriteSrcOnly(uintptr(to), uintptr(from), copymem)
		}
	}

	if raceenabled {
		callerpc := getcallerpc()
		pc := funcPC(makeslicecopy)
		racereadrangepc(from, copymem, callerpc, pc)
	}
	if msanenabled {
		msanread(from, copymem)
	}

	// 拷贝
	memmove(to, from, copymem)

	return to
}

// 新建一个len长cap容量的slice
func makeslice(et *_type, len, cap int) unsafe.Pointer {
	// 判断是否溢出
	mem, overflow := math.MulUintptr(et.size, uintptr(cap))
	if overflow || mem > maxAlloc || len < 0 || len > cap {
		// NOTE: Produce a 'len out of range' error instead of a
		// 'cap out of range' error when someone does make([]T, bignumber).
		// 'cap out of range' is true too, but since the cap is only being
		// supplied implicitly, saying len is clearer.
		// See golang.org/issue/4085.
		mem, overflow := math.MulUintptr(et.size, uintptr(len))
		if overflow || mem > maxAlloc || len < 0 {
			panicmakeslicelen()
		}
		panicmakeslicecap()
	}

	// 直接调用mallocgc进行分配，这个跟makeslicecopy不一样
	// makeslicecopy之所以可以区分et是否包含指针来处理，是因为新建完slice之后还会copy部分数据
	// 所以分配到的内存可以手动清零，尽量减少mallocgc的工作，提高内存分配的效率
	return mallocgc(mem, et, true)
}
```

### 拷贝
```go
// slicecopy is used to copy from a string or slice of pointerless elements into a slice.
// 从fromPtr中拷贝fromLen个元素到toPtr中
func slicecopy(toPtr unsafe.Pointer, toLen int, fromPtr unsafe.Pointer, fromLen int, width uintptr) int {
	// 前置校验
	if fromLen == 0 || toLen == 0 {
		return 0
	}

	n := fromLen
	// 如果要拷贝的长度比目标slice的长度还大，则以目标slice的长度为准
	if toLen < n {
		n = toLen
	}

	// 元素长度是0，无效操作
	if width == 0 {
		return n
	}

	size := uintptr(n) * width
	if raceenabled {
		callerpc := getcallerpc()
		pc := funcPC(slicecopy)
		racereadrangepc(fromPtr, size, callerpc, pc)
		racewriterangepc(toPtr, size, callerpc, pc)
	}
	if msanenabled {
		msanread(fromPtr, size)
		msanwrite(toPtr, size)
	}

	// 这里做了区分，如果只需要拷贝一个字节，就不调用memmove函数，算是一个性能优化的点吧
	// 不过这里也提出了疑问，对于新版的memmove这个优化点是否还有必要？
	if size == 1 { // common case worth about 2x to do here
		// TODO: is this still worth it with new memmove impl?
		// 只拷贝一个字节，直接指针操作即可
		*(*byte)(toPtr) = *(*byte)(fromPtr) // known to be a byte pointer
	} else {
		// 否则就调用memmove进行拷贝
		memmove(toPtr, fromPtr, size)
	}
	// 返回实际拷贝的长度
	return n
}
```

### 扩容
```go
// 根据新的容量cap对slice扩容
func growslice(et *_type, old slice, cap int) slice {
	if raceenabled {
		callerpc := getcallerpc()
		racereadrangepc(old.array, uintptr(old.len*int(et.size)), callerpc, funcPC(growslice))
	}
	if msanenabled {
		msanread(old.array, uintptr(old.len*int(et.size)))
	}

	// 扩容后容量还比之前小，非法
	if cap < old.cap {
		panic(errorString("growslice: cap out of range"))
	}

	// 特殊零值处理
	if et.size == 0 {
		// append should not create a slice with nil pointer but non-zero len.
		// We assume that append doesn't need to preserve old.array in this case.
		return slice{unsafe.Pointer(&zerobase), old.len, cap}
	}

	// 这段就是计算扩容后容量的实际逻辑
	// 1. 如果新cap比旧cap的两倍还要大，那新cap就是实际扩容的容量
	// 2. 1不满足的情况下，如果旧cap < 1024，那么2*旧cap就是实际扩容的容量
	// 3. 1,2都不满足的情况下，循环递增旧cap，每次递增旧cap的1/4，直到溢出或者大于新cap，最终递增的容量就是实际扩容的容量
	newcap := old.cap
	doublecap := newcap + newcap
	if cap > doublecap {
		newcap = cap
	} else {
		if old.cap < 1024 {
			newcap = doublecap
		} else {
			// Check 0 < newcap to detect overflow
			// and prevent an infinite loop.
			for 0 < newcap && newcap < cap {
				newcap += newcap / 4
			}
			// Set newcap to the requested cap when
			// the newcap calculation overflowed.
			if newcap <= 0 {
				newcap = cap
			}
		}
	}

	// 下面这段是通过上面计算出来的实际扩容量来计算通过mallocgc分配到的内存单元mspan的对象大小
	// 因为go的内存分配是按照68个对象大小进行分配的，所以分配到的内存有可能比计算出的实际扩容量大的
	// 这个时候我们需要通过实际分配到的内存来反向计算出最终扩容后的容量
	var overflow bool
	var lenmem, newlenmem, capmem uintptr
	// Specialize for common values of et.size.
	// For 1 we don't need any division/multiplication.
	// For sys.PtrSize, compiler will optimize division/multiplication into a shift by a constant.
	// For powers of 2, use a variable shift.
	switch {
	case et.size == 1:
		lenmem = uintptr(old.len)
		newlenmem = uintptr(cap)
		capmem = roundupsize(uintptr(newcap))
		overflow = uintptr(newcap) > maxAlloc
		newcap = int(capmem)
	case et.size == sys.PtrSize:
		lenmem = uintptr(old.len) * sys.PtrSize
		newlenmem = uintptr(cap) * sys.PtrSize
		// 计算实际内存分配大小
		capmem = roundupsize(uintptr(newcap) * sys.PtrSize)
		overflow = uintptr(newcap) > maxAlloc/sys.PtrSize
		// 通过内存大小反向计算容量
		newcap = int(capmem / sys.PtrSize)
	case isPowerOfTwo(et.size):
		var shift uintptr
		if sys.PtrSize == 8 {
			// Mask shift for better code generation.
			shift = uintptr(sys.Ctz64(uint64(et.size))) & 63
		} else {
			shift = uintptr(sys.Ctz32(uint32(et.size))) & 31
		}
		lenmem = uintptr(old.len) << shift
		newlenmem = uintptr(cap) << shift
		capmem = roundupsize(uintptr(newcap) << shift)
		overflow = uintptr(newcap) > (maxAlloc >> shift)
		newcap = int(capmem >> shift)
	default:
		lenmem = uintptr(old.len) * et.size
		newlenmem = uintptr(cap) * et.size
		capmem, overflow = math.MulUintptr(et.size, uintptr(newcap))
		capmem = roundupsize(capmem)
		newcap = int(capmem / et.size)
	}

	// The check of overflow in addition to capmem > maxAlloc is needed
	// to prevent an overflow which can be used to trigger a segfault
	// on 32bit architectures with this example program:
	//
	// type T [1<<27 + 1]int64
	//
	// var d T
	// var s []T
	//
	// func main() {
	//   s = append(s, d, d, d, d)
	//   print(len(s), "\n")
	// }
	// 溢出
	if overflow || capmem > maxAlloc {
		panic(errorString("growslice: cap out of range"))
	}

	// 这里跟makeslicecopy里的处理逻辑一致，不赘述
	var p unsafe.Pointer
	if et.ptrdata == 0 {
		p = mallocgc(capmem, nil, false)
		// The append() that calls growslice is going to overwrite from old.len to cap (which will be the new length).
		// Only clear the part that will not be overwritten.
		memclrNoHeapPointers(add(p, newlenmem), capmem-newlenmem)
	} else {
		// Note: can't use rawmem (which avoids zeroing of memory), because then GC can scan uninitialized memory.
		p = mallocgc(capmem, et, true)
		if lenmem > 0 && writeBarrier.enabled {
			// Only shade the pointers in old.array since we know the destination slice p
			// only contains nil pointers because it has been cleared during alloc.
			bulkBarrierPreWriteSrcOnly(uintptr(p), uintptr(old.array), lenmem-et.size+et.ptrdata)
		}
	}
	memmove(p, old.array, lenmem)

	return slice{p, old.len, newcap}
}
```