---
title: "Golang源码系列--map"
author: "Joker"
pubDatetime: 2022-01-22T01:08:39+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang map的实现源码解析"
---

### 概述
map是啥？怎么用？这两个问题搞不清楚的，不用往下看了，先弄清楚再说

### 源码解析
先看看参考资料
[深度解密Go语言之 map](https://juejin.cn/post/6844903848587296781#heading-8)
[map笔记](https://github.com/cch123/golang-notes/blob/master/map.md)
[Go源码学习之map](https://www.kevinwu0904.top/blogs/golang-map/#map%E7%9A%84%E5%88%9B%E5%BB%BA)
本文源码解析部分，会做一个全面的解析，补充上面没说到或者没说清楚的

#### 创建
```go
// map的数据结构
type hmap struct {
	// Note: the format of the hmap is also encoded in cmd/compile/internal/reflectdata/reflect.go.
	// Make sure this stays in sync with the compiler's definition.
	// map中kv的个数，可以使用len()获取
	count     int // # live cells == size of map.  Must be first (used by len() builtin)
	// 一些标记位
	flags     uint8
	// hash桶的数量，这里存的是次方，也就是说2^B才是桶的实际数量
	// 这么存的好处是可以通过简单的位运算来计算mask
	B         uint8  // log_2 of # of buckets (can hold up to loadFactor * 2^B items)
	// 溢出桶的数量
	// 所谓溢出桶就是通过链地址法解决冲突而产生的桶
	noverflow uint16 // approximate number of overflow buckets; see incrnoverflow for details
	// hash随机种子，用于生成hash随机数
	hash0     uint32 // hash seed

	// 是一个指针，指向桶，也就是hash数组
	buckets    unsafe.Pointer // array of 2^B Buckets. may be nil if count==0.
	// 扩容时用的，标记旧桶
	oldbuckets unsafe.Pointer // previous bucket array of half the size, non-nil only when growing
	// 扩容时桶的迁移进度标记，标识当前扩容迁移到了哪个桶
	nevacuate  uintptr        // progress counter for evacuation (buckets less than this have been evacuated)
	// 可选
	// 用于保存指向新旧溢出桶的指针
	// 还会保存指向备用溢出桶的指针
	extra *mapextra // optional fields
}

type mapextra struct {
	// If both key and elem do not contain pointers and are inline, then we mark bucket
	// type as containing no pointers. This avoids scanning such maps.
	// However, bmap.overflow is a pointer. In order to keep overflow buckets
	// alive, we store pointers to all overflow buckets in hmap.extra.overflow and hmap.extra.oldoverflow.
	// overflow and oldoverflow are only used if key and elem do not contain pointers.
	// overflow contains overflow buckets for hmap.buckets.
	// oldoverflow contains overflow buckets for hmap.oldbuckets.
	// The indirection allows to store a pointer to the slice in hiter.
	// 指向溢出桶指针切片的指针
	// 当桶的kv都不包含指针并且是内联的，就不需要gc每次都扫描所有的bucket
	// 同时为了保证不让gc干掉溢出桶，就将指向溢出桶的指针存在overflow中
	overflow    *[]*bmap
	oldoverflow *[]*bmap

	// nextOverflow holds a pointer to a free overflow bucket.
	// 指向备用溢出桶的指针，具体怎么用后面会说
	nextOverflow *bmap
}

// A bucket for a Go map.
// 这个是hash桶的结构
// hmap.buckets就是指向这里
type bmap struct {
	// tophash generally contains the top byte of the hash value
	// for each key in this bucket. If tophash[0] < minTopHash,
	// tophash[0] is a bucket evacuation state instead.
	// 顶部hash，用于快速筛查以及做一些状态标记，具体后面会说到
	tophash [bucketCnt]uint8
	// Followed by bucketCnt keys and then bucketCnt elems.
	// NOTE: packing all the keys together and then all the elems together makes the
	// code a bit more complicated than alternating key/elem/key/elem/... but it allows
	// us to eliminate padding which would be needed for, e.g., map[int64]int8.
	// Followed by an overflow pointer.
}

// 实际编译期间，bmap会经过反射生成真正的bmap类型
// 如下是cmd/compile/internal/reflectdata/reflect.go中115行代码
// 这里不做过多解释
field := make([]*types.Field, 0, 5)

// The first field is: uint8 topbits[BUCKETSIZE].
arr := types.NewArray(types.Types[types.TUINT8], BUCKETSIZE)
field = append(field, makefield("topbits", arr))

arr = types.NewArray(keytype, BUCKETSIZE)
arr.SetNoalg(true)
keys := makefield("keys", arr)
field = append(field, keys)

arr = types.NewArray(elemtype, BUCKETSIZE)
arr.SetNoalg(true)
elems := makefield("elems", arr)
field = append(field, elems)

// If keys and elems have no pointers, the map implementation
// can keep a list of overflow pointers on the side so that
// buckets can be marked as having no pointers.
// Arrange for the bucket to have no pointers by changing
// the type of the overflow field to uintptr in this case.
// See comment on hmap.overflow in runtime/map.go.
// 这里可以说下，这里会检查kv是否会包含指针
// 如果kv没有包含就定义为uintptr类型，从而标记桶不包含指针，与上面说的mapextra.overflow相呼应
// 这个之前在unsafe.Pointer的文章中说过，uintptr底层是整型非指针，而且gc也不会当做指针处理
otyp := types.Types[types.TUNSAFEPTR]
if !elemtype.HasPointers() && !keytype.HasPointers() {
	otyp = types.Types[types.TUINTPTR]
}
overflow := makefield("overflow", otyp)
field = append(field, overflow)

// 经过上面的一顿操作，bmap的最终结构大致就如下
// 这里注意kv的内存布局，不是k/v/k/v这么存，而是所有k连续，所有v连续，即k/k/v/v
// 这么做主要是因为go中的内存对齐，具体可看之前的文章
// 假设map[int64][int8]这种的，如果k/v/k/v这么存，需要的内存空间就会比k/k/v/v大
type bmap struct {
	// tophash
	topbits  [8]uint8
	// 存储k
	keys     [8]keytype
	// 存储v
	values   [8]valuetype
	// 这里是内存空洞，主要是为了保证overflow在bmap内存中的最后位置，具体原因后面会说到
	pad      uintptr
	// 指向下一个桶的指针
	overflow uintptr
}

func makemap(t *maptype, hint int, h *hmap) *hmap {
	// 判断是否溢出
	// math.MulUintptr这里不赘述了，看过之前源码文章的应该知道
	// 这里如果hint太大，导致计算后的字节数溢出了的话，会置为0，不会报panic
	mem, overflow := math.MulUintptr(uintptr(hint), t.bucket.size)
	if overflow || mem > maxAlloc {
		hint = 0
	}

	// new一个hmap
	if h == nil {
		h = new(hmap)
	}
	// 生成hash种子
	h.hash0 = fastrand()

	// Find the size parameter B which will hold the requested # of elements.
	// For hint < 0 overLoadFactor returns false since hint < bucketCnt.
	// 通过hint找符合要求的最小B，默认B是0，也就是2^0=1
	// overLoadFactor用于判断hint/2^B是否>负载因子，后面会说到
	B := uint8(0)
	for overLoadFactor(hint, B) {
		B++
	}
	// 赋值
	h.B = B

	// allocate initial hash table
	// if B == 0, the buckets field is allocated lazily later (in mapassign)
	// If hint is large zeroing this memory could take a while.
	// 如果B=0，对应的buckets内存会延迟分配，在map写入的时候
	if h.B != 0 {
		var nextOverflow *bmap
		// 调用makeBucketArray创建buckets，具体实现后面会说
		h.buckets, nextOverflow = makeBucketArray(t, h.B, nil)
		// 如果申请了备用桶内存，nextOverflow指针指向该内存块
		if nextOverflow != nil {
			h.extra = new(mapextra)
			h.extra.nextOverflow = nextOverflow
		}
	}
	// 返回hmap
	return h
}

// overLoadFactor reports whether count items placed in 1<<B buckets is over loadFactor.
// 用于判断hint/2^B是否>负载因子
// 这里负载因子是loadFactorNum/loadFactorDen = 13/2 = 6.5
// 即平均每个桶最多能写入6.5对kv
func overLoadFactor(count int, B uint8) bool {
	return count > bucketCnt && uintptr(count) > loadFactorNum*(bucketShift(B)/loadFactorDen)
}


// makeBucketArray initializes a backing array for map buckets.
// 1<<b is the minimum number of buckets to allocate.
// dirtyalloc should either be nil or a bucket array previously
// allocated by makeBucketArray with the same t and b parameters.
// If dirtyalloc is nil a new backing array will be alloced and
// otherwise dirtyalloc will be cleared and reused as backing array.
// 构建桶数组，其实就是分配一块连续的内存
func makeBucketArray(t *maptype, b uint8, dirtyalloc unsafe.Pointer) (buckets unsafe.Pointer, nextOverflow *bmap) {
	// 计算要新建多少个桶，即2^b，具体实现后面说
	base := bucketShift(b)
	// 把base先保存起来
	nbuckets := base
	// For small b, overflow buckets are unlikely.
	// Avoid the overhead of the calculation.
	// 如果b比较小，说明新建map的时候需求分配的长度就小，那么需要溢出桶的可能性不大
	// 这里有一个门限值，如果b >= 4即需要桶的数量 >= 16，就多申请一些空间备用，需要溢出桶的可能性比较大
	// 预留分配，可以避免后续频繁计算分配内容，也可以减少内存碎片
	if b >= 4 {
		// Add on the estimated number of overflow buckets
		// required to insert the median number of elements
		// used with this value of b.
		// 预留2^(b-4)个桶
		nbuckets += bucketShift(b - 4)
		sz := t.bucket.size * nbuckets
		// 计算mallocgc会分配多大的内存块，这里不是你申请多少就刚好分配你多少的，具体原因这里不细说，跟内存分配有关
		up := roundupsize(sz)
		if up != sz {
			// 以最终分配到的为准，看能cover住多少个桶，向下取整
			nbuckets = up / t.bucket.size
		}
	}

	// 这里分两种情况，第一种是dirtyalloc参数是nil
	// 这种情况就new一个bucket数组即可
	// 第二种就是dirtyalloc参数不是nil，那就复用这块内存而不新申请
	if dirtyalloc == nil {
		buckets = newarray(t.bucket, int(nbuckets))
	} else {
		// dirtyalloc was previously generated by
		// the above newarray(t.bucket, int(nbuckets))
		// but may not be empty.
		buckets = dirtyalloc
		size := t.bucket.size * nbuckets
		// 使用前需要清空内存块数据
		// 区分两种，一种是包含指针的，一种是不包含的
		// 这里区分主要是写屏障相关的，不详细说了
		if t.bucket.ptrdata != 0 {
			memclrHasPointers(buckets, size)
		} else {
			memclrNoHeapPointers(buckets, size)
		}
	}

	// 如果申请了备用空间
	if base != nbuckets {
		// We preallocated some overflow buckets.
		// To keep the overhead of tracking these overflow buckets to a minimum,
		// we use the convention that if a preallocated overflow bucket's overflow
		// pointer is nil, then there are more available by bumping the pointer.
		// We need a safe non-nil pointer for the last overflow bucket; just use buckets.
		// base是要申请的桶数，刨掉这部分占用的内存，后面就是多申请的，nextOverflow指向后面的多余部分
		// last是找到内存块最后一个桶的位置，然后让最后一个桶的overflow指向头桶(准确的说是指向指向头桶的指针)，具体实现后面会说
		nextOverflow = (*bmap)(add(buckets, base*uintptr(t.bucketsize)))
		last := (*bmap)(add(buckets, (nbuckets-1)*uintptr(t.bucketsize)))
		last.setoverflow(t, (*bmap)(buckets))
	}
	// 返回头桶和预留桶地址
	return buckets, nextOverflow
}

// bucketShift returns 1<<b, optimized for code generation.
// 计算2^b
func bucketShift(b uint8) uintptr {
	// Masking the shift amount allows overflow checks to be elided.
	// 等价于1 << b
	// 这里b & (sys.PtrSize*8 - 1) 等价于 b & (64 - 1) (假设是64位机器)
	// 而b & (64 - 1) <= 63，避免移位溢出，因为64位机器，最多只能左移63次
	return uintptr(1) << (b & (sys.PtrSize*8 - 1))
}

// 找到bucket的overflow，bucket的结构是bmap，上面说过bmap编译时候会通过reflect加点料，其中就有overflow
func (b *bmap) setoverflow(t *maptype, ovf *bmap) {
	// 这里强制转成**bmap是没有问题的，都是指针类型，所以类型是指向(指向bmap的指针)的指针
	*(**bmap)(add(unsafe.Pointer(b), uintptr(t.bucketsize)-sys.PtrSize)) = ovf
}
```

#### 访问
map的访问有5个方法
 - mapaccess1 返回指向h[k]的指针
 - mapaccess2 返回指向h[k]的指针和一个bool类型变量，用于标记map中是否有对应的key，还记得 v, ok := h[k]的写法吗
 - mapaccessK 同时返回kv，用于map遍历
 - mapaccess1_fat和mapaccess2_fat 这两都是mapaccess1的包装，如果map中不存在k，对应返回其类型零值，mapaccess2_fat多返回一个bool类型变量，功能同mapaccess2
看下mapaccess1的源码(其他的基本差别不大，不另赘述)
```go
// mapaccess1 returns a pointer to h[key].  Never returns nil, instead
// it will return a reference to the zero object for the elem type if
// the key is not in the map.
// NOTE: The returned pointer may keep the whole map live, so don't
// hold onto it for very long.
// mapaccess1返回指向h[key]的指针，永远不会返回nil
// 如果key不存在，会返回一个指向特殊对象的指针，方便其他方法进行判断
func mapaccess1(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer {
	if raceenabled && h != nil {
		callerpc := getcallerpc()
		pc := funcPC(mapaccess1)
		racereadpc(unsafe.Pointer(h), callerpc, pc)
		raceReadObjectPC(t.key, key, callerpc, pc)
	}
	if msanenabled && h != nil {
		msanread(key, t.key.size)
	}
	// 如果h没有初始化或者没有存任何kv对就直接返回特殊指针
	if h == nil || h.count == 0 {
		// 这里会检测key是否可以被hash
		// 具体原因看 https://github.com/golang/go/issues/23734
		// 大致意思就是如果传进来的k是slice、map或者func这些无法比较的key，应该给出具体的错误
		// 如果这里没有这个检查，返回对应的类型零值，就会产生规则混淆
		if t.hashMightPanic() {
			t.hasher(key, 0) // see issue 23734
		}
		// 返回特殊指针
		return unsafe.Pointer(&zeroVal[0])
	}
	// 如果有写map操作，抛异常，所以map不是并发安全的
	if h.flags&hashWriting != 0 {
		throw("concurrent map read and map write")
	}
	// 计算hash值
	hash := t.hasher(key, uintptr(h.hash0))
	// 这里m = (1 << b) -1，假设b=4 那么m=000...001111（即低四位都是1，其余都是0，这里用二进制表示）
	m := bucketMask(h.B)
	// 通过hash的二进制低b位计算目标桶号
	// 假设b=4，hash的低4位是0011，那么(hash&m) = xxx...xxx0011 & 000...001111 = 000...000011 = 3，即3号桶就是目标桶
	b := (*bmap)(add(h.buckets, (hash&m)*uintptr(t.bucketsize)))
	// 这段逻辑是为了兼容map扩容，扩容后面会说到
	// 如果h.oldbuckets不等于nil，说明正在扩容
	if c := h.oldbuckets; c != nil {
		// 如果不是等量扩容，新桶的h.B会加1即桶的数量翻倍
		// 那么旧桶对应的m就是新桶的一半，需要右移一位
		if !h.sameSizeGrow() {
			// There used to be half as many buckets; mask down one more power of two.
			m >>= 1
		}
		// 找到旧桶中的目标桶
		oldb := (*bmap)(add(c, (hash&m)*uintptr(t.bucketsize)))
		// 如果目标桶还没迁移到新桶，就将旧桶的目标桶作为最终目标桶
		if !evacuated(oldb) {
			b = oldb
		}
	}
	// 通过hash二进制高八位得到top，tophash后面会说
	top := tophash(hash)
bucketloop:
	// 遍历目标桶以及对应的所有溢出桶
	for ; b != nil; b = b.overflow(t) {
		// 遍历每个桶的8个kv对
		for i := uintptr(0); i < bucketCnt; i++ {
			// 先看b.tophash数组中是否有top，做一次快速筛选
			if b.tophash[i] != top {
				// 这里有一个特殊标识emptyRest，代表后面包括所有的桶都是空的，可以直接跳出两层循环结束查找
				// 关于如何维护emptyRest，后面会说到
				if b.tophash[i] == emptyRest {
					break bucketloop
				}
				// 跳过内层循环，快速筛选成功
				continue
			}
			// 找到对应的k
			// 这里dataOffset其实就是bmap后的第一个字节的位置，具体怎么来的后面会说
			// 还记得上面说的吧，bmap在编译期间会加料，就是在bmap后面新增k,v,pad和overflow
			// 这里dataOffset就是第一个k的位置对应bmap首字节的字节位移
			k := add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
			// 如果k存的是指针，就进行解引用
			if t.indirectkey() {
				// 这里面用到了*unsafe.Pointer，请注意*unsafe.Pointer是安全的，所以可以强制转换，就类似(*int)
				// 具体可以看这里 https://go101.org/article/unsafe.html
				// 反正记住两个go编译器的规则
				// 1. 一个安全的指针可以转换为不安全的指针即unsafe.Pointer，反之亦然
				// 2. 一个uintptr类型的值可以转换为不安全的指针，反之亦然，但是要注意如果指针是nil，则不应该转换为uintptr，并进行算术运算
				// 对于未知类型的k，我们可以通过如下方式来解引用得到具体的值
				k = *((*unsafe.Pointer)(k))
			}
			// 如果k相等说明找到了
			// 这里就是为什么map的key必须是可以比较的
			if t.key.equal(key, k) {
				// 先跳过bmap的tophash，再跳过8个k，再跳过i个v，就是要找的v
				e := add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
				// 如果v存的是指针，解引用，同上
				if t.indirectelem() {
					e = *((*unsafe.Pointer)(e))
				}
				// 返回v
				return e
			}
		}
	}
	// 返回不存在标识
	return unsafe.Pointer(&zeroVal[0])
}

// tophash calculates the tophash value for hash.
// 计算tophash
func tophash(hash uintptr) uint8 {
	// 取到hash的高8位
	top := uint8(hash >> (sys.PtrSize*8 - 8))
	// minTopHash=5, 如果top < 5，则top += 5
	// 这是因为0,1,2,3,4都是特殊标记值，有另外的作用，makemap解读的时候说过，tophash不仅有快筛的作用，还会有标记的作用
	// 所以当计算出来的tophash与标记值冲突时，进行冲突解决
	if top < minTopHash {
		top += minTopHash
	}
	return top
}

// data offset should be the size of the bmap struct, but needs to be
// aligned correctly. For amd64p32 this means 64-bit alignment
// even though pointers are 32 bit.
// 这里通过unsafe.Offsetof来计算bmap的size，是为了适配不同的处理器架构
dataOffset = unsafe.Offsetof(struct {
	b bmap
	v int64
}{}.v)
```
#### 写入
```go
// Like mapaccess, but allocates a slot for the key if it is not present in the map.
// 写map
// 里面可能会触发初始化操作，扩容操作
func mapassign(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer {
	// h是nil，直接panic
	// 比如 var m map[int]int，此时m=nil，操作m[1]=1就会panic
	if h == nil {
		panic(plainError("assignment to entry in nil map"))
	}
	if raceenabled {
		callerpc := getcallerpc()
		pc := funcPC(mapassign)
		racewritepc(unsafe.Pointer(h), callerpc, pc)
		raceReadObjectPC(t.key, key, callerpc, pc)
	}
	if msanenabled {
		msanread(key, t.key.size)
	}
	// 写并发异常
	if h.flags&hashWriting != 0 {
		throw("concurrent map writes")
	}
	// 计算hash
	hash := t.hasher(key, uintptr(h.hash0))

	// Set hashWriting after calling t.hasher, since t.hasher may panic,
	// in which case we have not actually done a write.
	// 这里在写入计算完hash之后写入写标记，因为计算hash可能会panic，而这个时候map并没有发生实际的写操作
	h.flags ^= hashWriting

	// 还记得makemap吧，有可能会延迟分配桶，这里就是延迟分配的地方
	if h.buckets == nil {
		// new一个桶
		h.buckets = newobject(t.bucket) // newarray(t.bucket, 1)
	}

again:
	// 寻找目标桶
	bucket := hash & bucketMask(h.B)
	// 如果正在扩容，那么现在的目标桶bucket是在新桶上
	if h.growing() {
		// 保证目标桶对应的旧桶已经迁移
		// growWrok是实际操作桶迁移的函数
		// 整个map的扩容过程中，旧桶迁移到新桶都是由写操作(写入/删除)触发逐步迁移的
		// 这么做也是为了不影响map的正常读写速度，类似redis扩容，一个套路
		// 具体如何扩容后面会说
		growWork(t, h, bucket)
	}
	// 迁移完后就可以直接写目标桶了
	b := (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
	top := tophash(hash)

	var inserti *uint8
	var insertk unsafe.Pointer
	var elem unsafe.Pointer
bucketloop:
	for {
		// 遍历目标桶的8对kv
		for i := uintptr(0); i < bucketCnt; i++ {
			// 如果tophash[i]不相等，说明要么就是存的别的kv对，要么就是空的
			if b.tophash[i] != top {
				// 如果是空的且预备写入位置还没找到
				// 就将当前空的位置作为预备写入tophash的位置
				// 这里还需要继续往后找，因为后面可能会找到目标kv
				// 删除操作会导致tophash中间有空档
				if isEmpty(b.tophash[i]) && inserti == nil {
					// 预备写入tophash的位置
					inserti = &b.tophash[i]
					// 预备写入k的位置
					insertk = add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
					// 预备写入v的位置
					elem = add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
				}
				// tophash[i]为空有两种
				// 一种是当前tophash[i]为空，还有一种是当前及后面所有(包括溢出桶)都为空
				// 回想下mapaccess1中说的emptyRest标识
				// 如果后面都是空，就不用继续找了，跳出两层循环
				if b.tophash[i] == emptyRest {
					break bucketloop
				}
				// 否则就继续找
				continue
			}
			// 如果通过tophash快速找到了，就继续找到对应的k
			k := add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
			// 这里不再细说了，上面说过了
			if t.indirectkey() {
				k = *((*unsafe.Pointer)(k))
			}
			// k不相等，继续找
			if !t.key.equal(key, k) {
				continue
			}
			// already have a mapping for key. Update it.
			// k相等，找到目标kv
			// 这里需要判断是否把k覆盖一遍
			// 有点迷惑，就是k都相等了，为啥要覆盖呢
			// 看看这里cmd/compile/internal/reflectdata/reflect.go
			// 具体我也不是很清楚，大概意思就是map[0]和map[+0]和map[-0]是一个kv，但是k不一样
			if t.needkeyupdate() {
				typedmemmove(t.key, k, key)
			}
			// 找到对应v的位置
			elem = add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
			// 跳到最后
			goto done
		}
		
		// 后面还有桶就继续找下一个桶
		// 没有桶了就跳出循环，说明需要写入新的kv
		ovf := b.overflow(t)
		if ovf == nil {
			break
		}
		b = ovf
	}

	// Did not find mapping for key. Allocate new cell & add entry.

	// If we hit the max load factor or we have too many overflow buckets,
	// and we're not already in the middle of growing, start growing.
	// 到这里说明没找到目标kv，也就是说是新插入一对kv，h.count需要加1，就触发判断是否扩容了
	// 如果map过载或者溢出桶太多，就会触发扩容，具体判断过载和溢出的函数后面会说
	if !h.growing() && (overLoadFactor(h.count+1, h.B) || tooManyOverflowBuckets(h.noverflow, h.B)) {
		// 扩容初始化，会判断是否需要分配新桶
		hashGrow(t, h)
		// 扩容准备好后，就从头再来一遍
		// 一个是为了触发当前桶迁移，二是迁移后会在新桶继续执行写操作
		goto again // Growing the table invalidates everything, so try again
	}

	// 如果inserti也是nil，说明目标桶及其所有的溢出桶都满了
	// 需要新建一个溢出桶
	if inserti == nil {
		// The current bucket and all the overflow buckets connected to it are full, allocate a new one.
		// 新建一个溢出桶，newoverflow函数后面会说
		newb := h.newoverflow(t, b)
		// 指定tophash的位置
		inserti = &newb.tophash[0]
		// 指定k的位置
		insertk = add(unsafe.Pointer(newb), dataOffset)
		// 指定v的位置
		elem = add(insertk, bucketCnt*uintptr(t.keysize))
	}

	// store new key/elem at insert position
	// 是否存指针，indirectkey上面说过，不再细说
	if t.indirectkey() {
		// 先new一个k
		kmem := newobject(t.key)
		// 再赋值到桶中k所在位置的内存中
		*(*unsafe.Pointer)(insertk) = kmem
		// 这里逻辑上同等于insertk = *insertk，让insertk指向新申请的k的内存块
		insertk = kmem
	}
	// 同上
	if t.indirectelem() {
		vmem := newobject(t.elem)
		*(*unsafe.Pointer)(elem) = vmem
	}
	// 新插入的kv的k赋值到insertk指向的内存
	typedmemmove(t.key, insertk, key)
	// 新桶的tophash[i] = top
	*inserti = top
	// kv对数加1
	h.count++

done:
	// 最后检查是否有并发异常
	if h.flags&hashWriting == 0 {
		throw("concurrent map writes")
	}
	// &^是置零操作，同等于h.flags &= ^hashWriting
	// 清除写标识
	h.flags &^= hashWriting
	if t.indirectelem() {
		// 这里跟上面insertk = kmem的意思是一样的，就是拿到v的实际值，即一个指向某个内存块的指针
		elem = *((*unsafe.Pointer)(elem))
	}
	// 返回v
	// 这里就结束了，有人会问，上面对k进行了赋值，但是没有对v赋值，只是返回而已
	// 其实这里调用方拿到v之后，会在外面进行赋值，具体可以通过go tool compile编译一段写map的代码看看
	return elem
}

// growing reports whether h is growing. The growth may be to the same size or bigger.
// map扩容的时候会创建新桶，旧桶会变成oldbuckets
// 这里通过判断是否有oldbuckets来确认map是否在扩容
func (h *hmap) growing() bool {
	return h.oldbuckets != nil
}

// 扩容的迁移操作
func growWork(t *maptype, h *hmap, bucket uintptr) {
	// make sure we evacuate the oldbucket corresponding
	// to the bucket we're about to use
	// 先迁移指定桶
	// evacuate函数，在扩容部分会单独详细说
	evacuate(t, h, bucket&h.oldbucketmask())

	// evacuate one more oldbucket to make progress on growing
	// 如果还没迁移完
	// 每次还会尝试多迁移一个桶
	if h.growing() {
		evacuate(t, h, h.nevacuate)
	}
}

// 新建一个溢出桶
func (h *hmap) newoverflow(t *maptype, b *bmap) *bmap {
	var ovf *bmap
	// 还记得nextOverflow吧，makemap的时候可能会申请预备桶空间，就是用nextOverflow来标记内存位置的
	// 这里派上用场了
	if h.extra != nil && h.extra.nextOverflow != nil {
		// We have preallocated overflow buckets available.
		// See makeBucketArray for more details.
		ovf = h.extra.nextOverflow
		// 再回忆一下makemap，当时申请预备桶空间后，还将最后一个桶的overflow指向头桶
		// 这里也派上用场了，通过这个能判断是否是预备桶的最后一个桶
		if ovf.overflow(t) == nil {
			// We're not at the end of the preallocated overflow buckets. Bump the pointer.
			// 如果不是最后一个桶，那就让nextOverflow往后挪一个桶，即释放一个预备桶到正式桶
			h.extra.nextOverflow = (*bmap)(add(unsafe.Pointer(ovf), uintptr(t.bucketsize)))
		} else {
			// This is the last preallocated overflow bucket.
			// Reset the overflow pointer on this bucket,
			// which was set to a non-nil sentinel value.
			// 如果是最后一个桶，说明预备桶用完了，那么nextOverflow指向nil，最后一个桶的overflow指向nil
			ovf.setoverflow(t, nil)
			h.extra.nextOverflow = nil
		}
	} else {
		// 如果没有申请预备桶空间或者预备桶之前就用完了，就申请一个新的桶
		ovf = (*bmap)(newobject(t.bucket))
	}
	// 更新溢出桶的计数
	h.incrnoverflow()
	// 这个ptrdata用于判断bucket是否包含指针
	// ptrdata=0表示不包含，具体可以看 cmd/compile/internal/types/size.go PtrDataSize函数
	if t.bucket.ptrdata == 0 {
		// 如果bucket是不包含指针的，那么如makemap所说的，就需要有h.extra.overflow来兜住所有指向溢出桶的指针
		// 检查并创建一个overflow，createOverflow方法很简单，不细说了
		h.createOverflow()
		// 将指向新桶的指针保存到overflow中
		*h.extra.overflow = append(*h.extra.overflow, ovf)
	}
	// 将当前桶连接上新的溢出桶
	b.setoverflow(t, ovf)
	return ovf
}


// incrnoverflow increments h.noverflow.
// noverflow counts the number of overflow buckets.
// This is used to trigger same-size map growth.
// See also tooManyOverflowBuckets.
// To keep hmap small, noverflow is a uint16.
// When there are few buckets, noverflow is an exact count.
// When there are many buckets, noverflow is an approximate count.
// 这里会新增noverflow
func (h *hmap) incrnoverflow() {
	// We trigger same-size map growth if there are
	// as many overflow buckets as buckets.
	// We need to be able to count to 1<<h.B.
	// 如果bucket < 2^16，就老老实实加1
	if h.B < 16 {
		h.noverflow++
		return
	}
	// Increment with probability 1/(1<<(h.B-15)).
	// When we reach 1<<15 - 1, we will have approximately
	// as many overflow buckets as buckets.
	// 否则就概率性的加1，也就是说如果B很大，buckets很多，那么这个值就是个近似值
	// 就是当B很大的时候，可以适当降低因为溢出桶太多而扩容的概率
	mask := uint32(1)<<(h.B-15) - 1
	// Example: if h.B == 18, then mask == 7,
	// and fastrand & 7 == 0 with probability 1/8.
	if fastrand()&mask == 0 {
		h.noverflow++
	}
}
```

#### 扩容
```go
// evacDst is an evacuation destination.
// evacDst用于桶迁移
type evacDst struct {
	// 迁移的目标桶
	b *bmap          // current destination bucket
	// 当前桶的迁移进度，即迁移了i对kv
	i int            // key/elem index into b
	// kv的迁移目标位置
	k unsafe.Pointer // pointer to current key storage
	e unsafe.Pointer // pointer to current elem storage
}

// tooManyOverflowBuckets reports whether noverflow buckets is too many for a map with 1<<B buckets.
// Note that most of these overflow buckets must be in sparse use;
// if use was dense, then we'd have already triggered regular map growth.
// 判断溢出桶是否过多
// 如果常规桶 > 2^15，那么就判断溢出桶数是否 >= 2^15
// 否则就判断溢出桶是否 >= 常规桶
func tooManyOverflowBuckets(noverflow uint16, B uint8) bool {
	// If the threshold is too low, we do extraneous work.
	// If the threshold is too high, maps that grow and shrink can hold on to lots of unused memory.
	// "too many" means (approximately) as many overflow buckets as regular buckets.
	// See incrnoverflow for more details.
	if B > 15 {
		B = 15
	}
	// The compiler doesn't see here that B < 16; mask B to generate shorter shift code.
	return noverflow >= uint16(1)<<(B&15)
}

// 桶扩容
// 如果是负载，那就让常规桶的数量翻倍
// 如果是溢出桶太多，常规桶的数量不变，整理所有桶使得kv排列更紧凑
func hashGrow(t *maptype, h *hmap) {
	// If we've hit the load factor, get bigger.
	// Otherwise, there are too many overflow buckets,
	// so keep the same number of buckets and "grow" laterally.
	// 是否扩充常规桶标识
	bigger := uint8(1)
	// 每增加一个kv对，都需要判断是否需要扩容然后调用该方法进行扩容
	// 所以是h.count+1
	if !overLoadFactor(h.count+1, h.B) {
		// 如果不是负载太高，bigger置为0
		bigger = 0
		// 标记为等容量扩容
		h.flags |= sameSizeGrow
	}
	// 原来的桶标记为旧桶
	oldbuckets := h.buckets
	// 申请新桶
	// 新桶的常规桶数量是2^(h.B+bigger)，如果bigger=1，就是翻倍，否则常规桶数不变
	newbuckets, nextOverflow := makeBucketArray(t, h.B+bigger, nil)

	// 这里是将旧桶的迭代标识复制给新桶，具体使用在桶的遍历中会说到
	flags := h.flags &^ (iterator | oldIterator)
	if h.flags&iterator != 0 {
		flags |= oldIterator
	}
	// commit the grow (atomic wrt gc)
	// 更新h.B
	h.B += bigger
	// 更新标识
	h.flags = flags
	// 更新旧桶
	h.oldbuckets = oldbuckets
	// 更新新桶
	h.buckets = newbuckets
	// 标记桶迁移进度
	h.nevacuate = 0
	// 新桶的溢出桶数量置为0
	h.noverflow = 0

	// 将指向旧溢出桶的指针挪到oldoverflow中
	// 因为overflow需要给新的溢出桶使用
	if h.extra != nil && h.extra.overflow != nil {
		// Promote current overflow buckets to the old generation.
		if h.extra.oldoverflow != nil {
			throw("oldoverflow is not nil")
		}
		h.extra.oldoverflow = h.extra.overflow
		h.extra.overflow = nil
	}
	// 新申请的桶可能申请了预备桶空间，nextOverflow指向对应内存块
	// 不记得了可以回去看下makeBucketArray函数
	if nextOverflow != nil {
		if h.extra == nil {
			h.extra = new(mapextra)
		}
		h.extra.nextOverflow = nextOverflow
	}

	// the actual copying of the hash table data is done incrementally
	// by growWork() and evacuate().
}

// 扩容桶迁移
// 参数里面会有个旧桶编号oldbucket
// 旧桶在写时触发迁移操作
// 该函数在hashGrow扩容之后调用
func evacuate(t *maptype, h *hmap, oldbucket uintptr) {
	// 根据桶号找到旧桶
	b := (*bmap)(add(h.oldbuckets, oldbucket*uintptr(t.bucketsize)))
	// 计算旧桶的常规桶数(不包括溢出桶)
	// 其实就是1 << h.B，这里的h.B是旧桶的
	newbit := h.noldbuckets()
	// 如果旧桶没有迁移到新桶
	if !evacuated(b) {
		// TODO: reuse overflow buckets instead of using new ones, if there
		// is no iterator using the old buckets.  (If !oldIterator.)

		// xy contains the x and y (low and high) evacuation destinations.
		// 定义两个evacDst，evacDst其实用来对应新桶的前半部分和后半部分
		// 还记得吧，过载扩容，新桶的h.B = 旧桶的h.B + 1
		// 假设原来的h.B=3，只需要取hash的后三位来计算桶编号即可
		// 扩容后h.B=4，就需要取hash的后四位来计算桶编号
		// hash的后第四位可能是1/0，如果是0桶编号不变，落到新桶的前半部分，如果是1则落到桶的后半部分
		var xy [2]evacDst
		x := &xy[0]
		// xy[0]对应前半部分
		// 确定对应前半部分的哪个桶
		// 因为前半部分的桶编号不变，所以这里编号就是参数oldbucket
		x.b = (*bmap)(add(h.buckets, oldbucket*uintptr(t.bucketsize)))
		// 对应桶的kv起始位置
		x.k = add(unsafe.Pointer(x.b), dataOffset)
		x.e = add(x.k, bucketCnt*uintptr(t.keysize))

		// 如果是过载扩容
		if !h.sameSizeGrow() {
			// Only calculate y pointers if we're growing bigger.
			// Otherwise GC can see bad pointers.
			// xy[1]对应后半部分
			y := &xy[1]
			// 因为是后半部分，所以hash的后第h.B+1位是1(这里的h.B对应旧桶)
			// 所以这里加上newbit
			y.b = (*bmap)(add(h.buckets, (oldbucket+newbit)*uintptr(t.bucketsize)))
			// 对应桶的kv起始位置
			y.k = add(unsafe.Pointer(y.b), dataOffset)
			y.e = add(y.k, bucketCnt*uintptr(t.keysize))
		}

		// 遍历旧桶以及对应的溢出桶
		for ; b != nil; b = b.overflow(t) {
			// 找到kv起始位置
			k := add(unsafe.Pointer(b), dataOffset)
			e := add(k, bucketCnt*uintptr(t.keysize))
			// 遍历8对kv
			for i := 0; i < bucketCnt; i, k, e = i+1, add(k, uintptr(t.keysize)), add(e, uintptr(t.elemsize)) {
				top := b.tophash[i]
				// 如果tophash[i]是空，继续找下一个kv对
				if isEmpty(top) {
					b.tophash[i] = evacuatedEmpty
					continue
				}
				// 检查tophash[i]是否是合法值，防止重入
				if top < minTopHash {
					throw("bad map state")
				}
				// 取到k的值
				k2 := k
				if t.indirectkey() {
					k2 = *((*unsafe.Pointer)(k2))
				}
				// useY用于标识是否使用新桶的后半部分，这取决于k的hash值
				var useY uint8
				// 如果是过载扩容
				if !h.sameSizeGrow() {
					// Compute hash to make our evacuation decision (whether we need
					// to send this key/elem to bucket x or bucket y).
					// 计算k的hash值
					hash := t.hasher(k2, uintptr(h.hash0))
					// 检查特殊情况，具体在背景部分贴的其他文章里面有详细描述，这里不再赘述
					// 大致意思就是对于某些特殊的k，每次计算出来的hash值都不一样，所以没法通过hash值来判断是放到新桶的前半部分还是后半部分
					if h.flags&iterator != 0 && !t.reflexivekey() && !t.key.equal(k2, k2) {
						// If key != key (NaNs), then the hash could be (and probably
						// will be) entirely different from the old hash. Moreover,
						// it isn't reproducible. Reproducibility is required in the
						// presence of iterators, as our evacuation decision must
						// match whatever decision the iterator made.
						// Fortunately, we have the freedom to send these keys either
						// way. Also, tophash is meaningless for these kinds of keys.
						// We let the low bit of tophash drive the evacuation decision.
						// We recompute a new random tophash for the next level so
						// these keys will get evenly distributed across all buckets
						// after multiple grows.
						// 约定一种规则来处理这种特殊的k，随机放到新桶前/后半部分
						useY = top & 1
						// 因为hash变了，所以top也变了
						top = tophash(hash)
					} else {
						// 通过hash来判断
						if hash&newbit != 0 {
							// 如果判断是落到后半部分，useY = 1
							useY = 1
						}
					}
				}
				// 这里是检查落到新桶前半部分的标记值和落到后半部分的标记值是否符合后续的计算逻辑
				// 因为这两个标记有可能会变，即使变了，也需要符合下面的规则
				if evacuatedX+1 != evacuatedY || evacuatedX^1 != evacuatedY {
					throw("bad evacuatedN")
				}
				// 通过useY的不同值来加和出不同的标记即evacuatedX和evacuatedY
				// 这就是上面if判断的原因
				// 同时赋值给tophash[i]来保存标记，还记得吧，这就是之前说过的tophash[i]的第二种功能
				b.tophash[i] = evacuatedX + useY // evacuatedX + 1 == evacuatedY
				// 确认使用哪个evacDst
				dst := &xy[useY]                 // evacuation destination

				// 这里检测dst对应的桶即dst.b是否已经满了
				// 上面的for循环是遍历旧桶，而且只有kv对不为空的时候，才会挪动到新桶，dst.i才会+1
				// 通过上述操作，新桶就会跳过旧桶的空kv对，达到紧凑的效果
				if dst.i == bucketCnt {
					// 既然当前桶满了，那就新建一个溢出桶
					dst.b = h.newoverflow(t, dst.b)
					// dst.i置为0，重新为新建的溢出桶计数
					dst.i = 0
					// 重置k和e，指向溢出桶kv的起始位置
					dst.k = add(unsafe.Pointer(dst.b), dataOffset)
					dst.e = add(dst.k, bucketCnt*uintptr(t.keysize))
				}
				// 设置新目标桶的tophash
				// 这里通过位与操作来避免溢出
				dst.b.tophash[dst.i&(bucketCnt-1)] = top // mask dst.i as an optimization, to avoid a bounds check
				// 迁移k的值到新目标桶
				// 区分指针和非指针
				if t.indirectkey() {
					*(*unsafe.Pointer)(dst.k) = k2 // copy pointer
				} else {
					typedmemmove(t.key, dst.k, k) // copy elem
				}
				// 迁移v的值到新目标桶
				if t.indirectelem() {
					*(*unsafe.Pointer)(dst.e) = *(*unsafe.Pointer)(e)
				} else {
					typedmemmove(t.elem, dst.e, e)
				}
				// 计数加1
				dst.i++
				// These updates might push these pointers past the end of the
				// key or elem arrays.  That's ok, as we have the overflow pointer
				// at the end of the bucket to protect against pointing past the
				// end of the bucket.
				// k和e分别向后挪，指向下一个kv对
				dst.k = add(dst.k, uintptr(t.keysize))
				dst.e = add(dst.e, uintptr(t.elemsize))
			}
		}
		// Unlink the overflow buckets & clear key/elem to help GC.
		// 如果旧桶没有在遍历并且bucket有指针
		// 就将旧目标桶(除了tophash)以及对应溢出桶占用的内存都释放掉，辅助gc，减少内存占用
		// 保留目标桶的tophash是为了标记该桶以及对应的溢出桶都已经被迁移了
		// 判断bucket是否包含指针是因为如果bucket不包含指针，那么指向所有溢出桶的指针会保留在oldoverflow中
		// 而oldoverflow保留的是全部溢出桶，也没法部分删掉，所以即使清空了溢出桶的内存，依然有指针指向，gc也没法回收
		if h.flags&oldIterator == 0 && t.bucket.ptrdata != 0 {
			b := add(h.oldbuckets, oldbucket*uintptr(t.bucketsize))
			// Preserve b.tophash because the evacuation
			// state is maintained there.
			ptr := add(b, dataOffset)
			n := uintptr(t.bucketsize) - dataOffset
			memclrHasPointers(ptr, n)
		}
	}
	// 如果当前桶编号和迁移进度一致，就触发迁移进度的更新
	if oldbucket == h.nevacuate {
		advanceEvacuationMark(h, t, newbit)
	}
}

// 更新桶的迁移进度也是一个随机+渐进的过程
func advanceEvacuationMark(h *hmap, t *maptype, newbit uintptr) {
	// 进度加1
	h.nevacuate++
	// Experiments suggest that 1024 is overkill by at least an order of magnitude.
	// Put it in there as a safeguard anyway, to ensure O(1) behavior.
	// 这个主要是为了控制for循环的次数，以保证map的O(1)操作
	stop := h.nevacuate + 1024
	if stop > newbit {
		stop = newbit
	}
	// 循环统计迁移的桶数并更新迁移进度
	for h.nevacuate != stop && bucketEvacuated(t, h, h.nevacuate) {
		h.nevacuate++
	}
	// 最终所有的桶都迁移完毕，开始清理旧桶
	if h.nevacuate == newbit { // newbit == # of oldbuckets
		// Growing is all done. Free old main bucket array.
		// 释放旧桶
		h.oldbuckets = nil
		// Can discard old overflow buckets as well.
		// If they are still referenced by an iterator,
		// then the iterator holds a pointers to the slice.
		if h.extra != nil {
			// 清理指向旧溢出桶的指针
			h.extra.oldoverflow = nil
		}
		// 清空等量扩容标识
		h.flags &^= sameSizeGrow
	}
}
```

#### 删除
```go
// 删除map中的指定kv
func mapdelete(t *maptype, h *hmap, key unsafe.Pointer) {
  if raceenabled && h != nil {
    callerpc := getcallerpc()
    pc := funcPC(mapdelete)
    racewritepc(unsafe.Pointer(h), callerpc, pc)
    raceReadObjectPC(t.key, key, callerpc, pc)
  }
  if msanenabled && h != nil {
    msanread(key, t.key.size)
  }
  // 前面说过，不细说了
  if h == nil || h.count == 0 {
    if t.hashMightPanic() {
      t.hasher(key, 0) // see issue 23734
    }
    return
  }
  // 同上
  if h.flags&hashWriting != 0 {
    throw("concurrent map writes")
  }

  // 计算k的hash值
  hash := t.hasher(key, uintptr(h.hash0))

  // Set hashWriting after calling t.hasher, since t.hasher may panic,
  // in which case we have not actually done a write (delete).
  // 设置写标记
  h.flags ^= hashWriting

  // 跟mapassign同样的操作
  // 获取桶，判断是否扩容，桶迁移等一系列操作
  bucket := hash & bucketMask(h.B)
  if h.growing() {
    growWork(t, h, bucket)
  }
  b := (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
  bOrig := b
  top := tophash(hash)
search:
  // 遍历目标桶及溢出桶找需要删除的kv
  for ; b != nil; b = b.overflow(t) {
    for i := uintptr(0); i < bucketCnt; i++ {
      if b.tophash[i] != top {
        // emptyRest标记前面说过
        if b.tophash[i] == emptyRest {
          break search
        }
        continue
      }
      // tophash筛选找到，再判断k是否相等
      k := add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
      k2 := k
      if t.indirectkey() {
        k2 = *((*unsafe.Pointer)(k2))
      }
      if !t.key.equal(key, k2) {
        continue
      }
      // Only clear key if there are pointers in it.
      // 如果k保存的是指针，直接指向nil
      // 如果k包含指针，比如是个struct，包着指针，就调用对应方法清理内存
      if t.indirectkey() {
        *(*unsafe.Pointer)(k) = nil
      } else if t.key.ptrdata != 0 {
        memclrHasPointers(k, t.key.size)
      }
      // 找到k对应的v
      // 同样的操作，清空v
      e := add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
      if t.indirectelem() {
        *(*unsafe.Pointer)(e) = nil
      } else if t.elem.ptrdata != 0 {
        memclrHasPointers(e, t.elem.size)
      } else {
        memclrNoHeapPointers(e, t.elem.size)
      }
      // 清空完之后更新tophash[i]
      // 标识空，用于快速筛选
      b.tophash[i] = emptyOne
      // If the bucket now ends in a bunch of emptyOne states,
      // change those to emptyRest states.
      // It would be nice to make this a separate function, but
      // for loops are not currently inlineable.
      // 后面这些操作主要是为了维护emptyRest标志，该标志代表的意思前面说过了
      // 怎么维护呢，先以被删除的kv对的位置i向后看一位
      // 两种情况，第一种被删除的kv是该桶的最后一个kv对，那么如果有溢出桶就继续看溢出桶的tophash[0]标识，否则就向前追溯
      // 第二种被删除的kv不是该桶的最后一个kv对，那就看后一个tophash标识即tophash[i+1]
      // 如果tophash[i+1]是emptyRest，就向前追溯
      if i == bucketCnt-1 {
        if b.overflow(t) != nil && b.overflow(t).tophash[0] != emptyRest {
          goto notLast
        }
      } else {
        if b.tophash[i+1] != emptyRest {
          goto notLast
        }
      }
      // 这就是追溯过程
      // 通过上面分析可知如果tophash[i+1]或者溢出桶的tophash[0]等于emptyRest
      // 那么当前的tophash[i]也可设置为emptyRest
      // 既然当前的tophash[i]是emptyRest，那么前面的所有连续的n个等于emptyOne的空的tophash也都可以设置成emptyRest
      // 有点类似抽屉原理，不了解的可以看看raft协议
      for {
        // 当前tophash设置为emptyRest
        b.tophash[i] = emptyRest
        // 如果是头部kv
        if i == 0 {
          // 如果是头桶，说明追溯完了
          if b == bOrig {
            break // beginning of initial bucket, we're done.
          }
          // Find previous bucket, continue at its last entry.
          // 否则就找当前桶的前面那个桶
          // 因为桶之间只有单向顺序指针连接，所以这里需要通过遍历来找
          c := b
          for b = bOrig; b.overflow(t) != c; b = b.overflow(t) {
          }
          // 找到上个桶后，从最后一个kv对逐步逆序检查tophash标识
          i = bucketCnt - 1
        } else {
          // 如果不是头部kv，继续追溯
          i--
        }
        // 一旦找到某个tophash[i]不是空，则跳出循环，追溯完毕
        if b.tophash[i] != emptyOne {
          break
        }
      }
    notLast:
      // map的元素个数减一
      h.count--
      // Reset the hash seed to make it more difficult for attackers to
      // repeatedly trigger hash collisions. See issue 25237.
      // 如果map被清空了，就重置hash种子
      // 这么做可以提升hash冲突的攻击难度
      // 具体原因见 https://github.com/golang/go/issues/25237
      if h.count == 0 {
        h.hash0 = fastrand()
      }
      // 跳出外层循环
      break search
    }
  }

  // 这里跟mapassign一样的，不细说了
  if h.flags&hashWriting == 0 {
    throw("concurrent map writes")
  }
  h.flags &^= hashWriting
}
```

#### 清空
```go
// mapclear deletes all keys from a map.
// 清空整个map
func mapclear(t *maptype, h *hmap) {
	if raceenabled && h != nil {
		callerpc := getcallerpc()
		pc := funcPC(mapclear)
		racewritepc(unsafe.Pointer(h), callerpc, pc)
	}

	// 本来就是空的
	if h == nil || h.count == 0 {
		return
	}

	// 并发写控制
	if h.flags&hashWriting != 0 {
		throw("concurrent map writes")
	}
	// 设置写标志
	h.flags ^= hashWriting

	// 清空等量扩容标志
	h.flags &^= sameSizeGrow
	// 清空旧桶，数据都清空了，就没必要扩容了，旧桶也就不需要了
	h.oldbuckets = nil
	// 清空各种计数器，迁移进度计数器，溢出桶计数器和kv对数量计数器
	h.nevacuate = 0
	h.noverflow = 0
	h.count = 0

	// Reset the hash seed to make it more difficult for attackers to
	// repeatedly trigger hash collisions. See issue 25237.
	// 重置hash种子，原因之前说过了
	h.hash0 = fastrand()

	// Keep the mapextra allocation but clear any extra information.
	// 清空扩展信息，释放内存
	// 包括指向新旧溢出桶的所有指针和指向预备桶内存块指针
	if h.extra != nil {
		*h.extra = mapextra{}
	}

	// makeBucketArray clears the memory pointed to by h.buckets
	// and recovers any overflow buckets by generating them
	// as if h.buckets was newly alloced.
	// 通过makeBucketArray来清空并复用map的buckets
	// 这里的buckets就是之前通过该方法申请的
	_, nextOverflow := makeBucketArray(t, h.B, h.buckets)
	// 还记得makeBucketArray会多申请一部分空间作为预备桶吧
	// 这里只进行清空操作，之前哪些是常规桶空间哪些是预备桶空间不变，方便再次写入kv时减少溢出桶的申请次数
	if nextOverflow != nil {
		// If overflow buckets are created then h.extra
		// will have been allocated during initial bucket creation.
		h.extra.nextOverflow = nextOverflow
	}

	// 并发写控制
	if h.flags&hashWriting == 0 {
		throw("concurrent map writes")
	}
	// 清空写标记
	h.flags &^= hashWriting
}
```
这里有人可能比较困惑，因为map并未提供清空操作，mapclear何时会调用呢，这里先看一段代码
```go
func main() {
	m := make(map[int]int, 2)
	for i := 0; i < 5; i++ {
		m[i] = i
	}
	for k := range m {
		delete(m, k)
	}
}
```
通过`go tool compile -S`编译出来的汇编代码中有一行如下
![01.png](/images/go-source/01.png)
也就是说，编译器做了优化，调用了mapclear而不是通过迭代进行了清空，如果把`for k := range m`改成`for k,_ := range m`或者`for k,v := range m`，编译器就不会进行优化，会选择迭代的方式进行清空，所以写法上需要注意

#### 遍历
```go
// A hash iteration structure.
// If you modify hiter, also change cmd/compile/internal/reflectdata/reflect.go to indicate
// the layout of this structure.
// 用于map迭代的数据结构
type hiter struct {
	// 当前迭代的k，如果key=nil，说明迭代结束了
	key         unsafe.Pointer // Must be in first position.  Write nil to indicate iteration end (see cmd/compile/internal/walk/range.go).
	// 当前迭代的v
	elem        unsafe.Pointer // Must be in second position (see cmd/compile/internal/walk/range.go).
	t           *maptype
	h           *hmap
	buckets     unsafe.Pointer // bucket ptr at hash_iter initialization time
	// 指向当前正在遍历的桶
	bptr        *bmap          // current bucket
	overflow    *[]*bmap       // keeps overflow buckets of hmap.buckets alive
	oldoverflow *[]*bmap       // keeps overflow buckets of hmap.oldbuckets alive
	// 标记从哪个桶开始遍历，每次是随机的
	startBucket uintptr        // bucket iteration started at
	// 标记总遍历桶的那个kv对开始遍历，每次也是随机的
	offset      uint8          // intra-bucket offset to start from during iteration (should be big enough to hold bucketCnt-1)
	// 标记是否从最后一个桶回绕到了第一个桶
	wrapped     bool           // already wrapped around from end of bucket array to beginning
	B           uint8
	i           uint8
	bucket      uintptr
	checkBucket uintptr
}


// mapiterinit initializes the hiter struct used for ranging over maps.
// The hiter struct pointed to by 'it' is allocated on the stack
// by the compilers order pass or on the heap by reflect_mapiterinit.
// Both need to have zeroed hiter since the struct contains pointers.
// 初始化hiter
func mapiterinit(t *maptype, h *hmap, it *hiter) {
	if raceenabled && h != nil {
		callerpc := getcallerpc()
		racereadpc(unsafe.Pointer(h), callerpc, funcPC(mapiterinit))
	}

	if h == nil || h.count == 0 {
		return
	}

	if unsafe.Sizeof(hiter{})/sys.PtrSize != 12 {
		throw("hash_iter size incorrect") // see cmd/compile/internal/reflectdata/reflect.go
	}
	it.t = t
	it.h = h

	// grab snapshot of bucket state
	// 保留快照
	it.B = h.B
	it.buckets = h.buckets
	if t.bucket.ptrdata == 0 {
		// Allocate the current slice and remember pointers to both current and old.
		// This preserves all relevant overflow buckets alive even if
		// the table grows and/or overflow buckets are added to the table
		// while we are iterating.
		h.createOverflow()
		it.overflow = h.extra.overflow
		it.oldoverflow = h.extra.oldoverflow
	}

	// decide where to start
	// 找随机开始位置
	r := uintptr(fastrand())
	if h.B > 31-bucketCntBits {
		r += uintptr(fastrand()) << 31
	}
	it.startBucket = r & bucketMask(h.B)
	it.offset = uint8(r >> h.B & (bucketCnt - 1))

	// iterator state
	// bucket用于记录当前遍历的桶序号，刚开始等于startBucket
	// 注意it.bucket始终都是新桶的编号，即使桶扩容了
	// 遍历的顺序就是从新桶的第bucket个桶开始(即startBucket)，纵向向下遍历所有溢出桶，遍历完后横向向右继续遍历其他常规桶，遍历到尾部后继续回绕到头桶，重复纵向横向遍历直到回到startBucket号桶
	// 遍历每一个bucket号桶的时候还需要检查是否是在扩容，如果在扩容，还需要找到对应未迁移的旧桶，对旧桶进行纵向遍历
	it.bucket = it.startBucket

	// Remember we have an iterator.
	// Can run concurrently with another mapiterinit().
	// 设置迭代标识
	if old := h.flags; old&(iterator|oldIterator) != iterator|oldIterator {
		atomic.Or8(&h.flags, iterator|oldIterator)
	}

	// 开始迭代
	mapiternext(it)
}


func mapiternext(it *hiter) {
	h := it.h
	if raceenabled {
		callerpc := getcallerpc()
		racereadpc(unsafe.Pointer(h), callerpc, funcPC(mapiternext))
	}
	if h.flags&hashWriting != 0 {
		throw("concurrent map iteration and map write")
	}
	t := it.t
	bucket := it.bucket
	b := it.bptr
	i := it.i
	checkBucket := it.checkBucket

next:
	// 如果当前桶是nil，也就是说遍历完了头桶和对应的所有溢出桶
	if b == nil {
		// 检查是否遍历了一圈回到了初始遍历的那个桶
		// 以此来判断是否遍历结束
		if bucket == it.startBucket && it.wrapped {
			// end of iteration
			it.key = nil
			it.elem = nil
			return
		}
		// 如果在扩容期间进行的迭代
		if h.growing() && it.B == h.B {
			// Iterator was started in the middle of a grow, and the grow isn't done yet.
			// If the bucket we're looking at hasn't been filled in yet (i.e. the old
			// bucket hasn't been evacuated) then we need to iterate through the old
			// bucket and only return the ones that will be migrated to this bucket.
			// 找到对应的旧桶
			// 因为扩容期间，旧桶有可能还没有迁移到新桶，那么我们就需要遍历旧桶
			oldbucket := bucket & it.h.oldbucketmask()
			b = (*bmap)(add(h.oldbuckets, oldbucket*uintptr(t.bucketsize)))
			// 如果旧桶没有迁移
			if !evacuated(b) {
				// 将旧桶和当前桶映射起来
				checkBucket = bucket
			} else {
				// 否则就遍历当前桶
				b = (*bmap)(add(it.buckets, bucket*uintptr(t.bucketsize)))
				// 标记无旧桶需要遍历
				checkBucket = noCheck
			}
		} else {
			// 如果没有在扩容，同上
			b = (*bmap)(add(it.buckets, bucket*uintptr(t.bucketsize)))
			checkBucket = noCheck
		}
		// 遍历桶编号加1
		bucket++
		// 如果最后一个桶都遍历完了，就回绕到头桶并且打上回绕标志
		if bucket == bucketShift(it.B) {
			bucket = 0
			it.wrapped = true
		}
		// 每次遍历桶的时候，i都从0开始，用于遍历该桶的8对kv
		i = 0
	}
	for ; i < bucketCnt; i++ {
		// 通过offset来打乱kv遍历的顺序
		offi := (i + it.offset) & (bucketCnt - 1)
		// 如果是空的，就跳过继续遍历下一对kv
		if isEmpty(b.tophash[offi]) || b.tophash[offi] == evacuatedEmpty {
			// TODO: emptyRest is hard to use here, as we start iterating
			// in the middle of a bucket. It's feasible, just tricky.
			continue
		}
		k := add(unsafe.Pointer(b), dataOffset+uintptr(offi)*uintptr(t.keysize))
		if t.indirectkey() {
			k = *((*unsafe.Pointer)(k))
		}
		e := add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+uintptr(offi)*uintptr(t.elemsize))
		// 如果当前遍历的是旧桶并且不是等容量扩容
		// 需要判断旧桶的kv对应到新桶是不是bucket号桶
		// 还记得扩容迁移吧，旧桶的kv迁移到新桶是可能落到前半部分和后半部分的
		// 如果当前遍历到的kv落到新桶不是bucket号桶，那就直接跳过了
		if checkBucket != noCheck && !h.sameSizeGrow() {
			// Special case: iterator was started during a grow to a larger size
			// and the grow is not done yet. We're working on a bucket whose
			// oldbucket has not been evacuated yet. Or at least, it wasn't
			// evacuated when we started the bucket. So we're iterating
			// through the oldbucket, skipping any keys that will go
			// to the other new bucket (each oldbucket expands to two
			// buckets during a grow).
			// 这里面区分两种情况，一种hash(k)是稳定的
			// 另一种hash(k)是不稳定的，比如math.NaN()
			// 具体规则扩容迁移的时候说过了，这里不赘述了
			if t.reflexivekey() || t.key.equal(k, k) {
				// If the item in the oldbucket is not destined for
				// the current new bucket in the iteration, skip it.
				hash := t.hasher(k, uintptr(h.hash0))
				if hash&bucketMask(it.B) != checkBucket {
					continue
				}
			} else {
				// Hash isn't repeatable if k != k (NaNs).  We need a
				// repeatable and randomish choice of which direction
				// to send NaNs during evacuation. We'll use the low
				// bit of tophash to decide which way NaNs go.
				// NOTE: this case is why we need two evacuate tophash
				// values, evacuatedX and evacuatedY, that differ in
				// their low bit.
				if checkBucket>>(it.B-1) != uintptr(b.tophash[offi]&1) {
					continue
				}
			}
		}
		// 如果当前遍历到的kv没有迁移到新桶，则赋值给it，遍历完成
		// 还有一种情况就是key!=key，比如上面说的math.NaN()，这种key没法删除和更新，也访问不到(除了遍历)
		// 所以不会被删除，可以直接取
		if (b.tophash[offi] != evacuatedX && b.tophash[offi] != evacuatedY) ||
			!(t.reflexivekey() || t.key.equal(k, k)) {
			// This is the golden data, we can return it.
			// OR
			// key!=key, so the entry can't be deleted or updated, so we can just return it.
			// That's lucky for us because when key!=key we can't look it up successfully.
			it.key = k
			if t.indirectelem() {
				e = *((*unsafe.Pointer)(e))
			}
			it.elem = e
		} else {
			// The hash table has grown since the iterator was started.
			// The golden data for this key is now somewhere else.
			// Check the current hash table for the data.
			// This code handles the case where the key
			// has been deleted, updated, or deleted and reinserted.
			// NOTE: we need to regrab the key as it has potentially been
			// updated to an equal() but not identical key (e.g. +0.0 vs -0.0).
			// 遍历过程中，当前k被删除/更新/删除后又重新插入等
			// 就需要重新找，具体怎么找，mapaccessK后面会说
			rk, re := mapaccessK(t, h, k)
			if rk == nil {
				continue // key has been deleted
			}
			it.key = rk
			it.elem = re
		}
		// 保留迭代现场
		// 遍历到哪个桶了，实际遍历的是哪个桶(可能新桶可能旧桶)，新旧桶是否有映射以及桶内kv的遍历进度
		// 用于下次继续遍历
		it.bucket = bucket
		if it.bptr != b { // avoid unnecessary write barrier; see issue 14921
			it.bptr = b
		}
		it.i = i + 1
		it.checkBucket = checkBucket
		return
	}
	// 当前桶没遍历完了，继续下一个溢出桶，除了i其他不变
	b = b.overflow(t)
	i = 0
	// 继续遍历
	goto next
}


// returns both key and elem. Used by map iterator
// 比较简单，其实就是通过key找到对应的新桶好旧桶
// 如果旧桶没有迁移就从旧桶找
// 否则就从新桶找
// 找的过程跟mapaccess1没啥区别
// 就是一个桶一个桶的遍历，遇到emptyRest就跳出外循环
// 然后对比k是否相等
// 这里就不详细注释了
func mapaccessK(t *maptype, h *hmap, key unsafe.Pointer) (unsafe.Pointer, unsafe.Pointer) {
	if h == nil || h.count == 0 {
		return nil, nil
	}
	hash := t.hasher(key, uintptr(h.hash0))
	m := bucketMask(h.B)
	b := (*bmap)(add(h.buckets, (hash&m)*uintptr(t.bucketsize)))
	if c := h.oldbuckets; c != nil {
		if !h.sameSizeGrow() {
			// There used to be half as many buckets; mask down one more power of two.
			m >>= 1
		}
		oldb := (*bmap)(add(c, (hash&m)*uintptr(t.bucketsize)))
		if !evacuated(oldb) {
			b = oldb
		}
	}
	top := tophash(hash)
bucketloop:
	for ; b != nil; b = b.overflow(t) {
		for i := uintptr(0); i < bucketCnt; i++ {
			if b.tophash[i] != top {
				if b.tophash[i] == emptyRest {
					break bucketloop
				}
				continue
			}
			k := add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
			if t.indirectkey() {
				k = *((*unsafe.Pointer)(k))
			}
			if t.key.equal(key, k) {
				e := add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
				if t.indirectelem() {
					e = *((*unsafe.Pointer)(e))
				}
				return k, e
			}
		}
	}
	return nil, nil
}
```

### 总结
至于总结，就引用下[这个](https://zhuanlan.zhihu.com/p/66676224)吧，我写累了，需要休息会~