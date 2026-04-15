---
title: "Golang源码系列--strings"
author: "Joker"
pubDatetime: 2022-02-13T19:23:42+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang strings的实现源码解析"
---

### 概述
`strings`包提供了一些常用的字符串操作，对于中文也是友好的

### Index
```go
// Index returns the index of the first instance of substr in s, or -1 if substr is not present in s.
// 从字符串s中找子串substr第一次出现的索引位置，如果没有则返回-1
// 该方法用到了暴力匹配和RabinKarp算法
func Index(s, substr string) int {
	// 获取子串长度
	n := len(substr)
	switch {
	// 子串长度是0，则返回0
	case n == 0:
		return 0
	// 子串长度是1，则使用IndexByte进行字节匹配即可
	// IndexByte是用汇编实现的，就是普通的暴力匹配解法
	case n == 1:
		return IndexByte(s, substr[0])
	// 子串长度=匹配串长度，直接比较两个串
	case n == len(s):
		if substr == s {
			return 0
		}
		return -1
	// 子串长度 > 匹配串长度，不可能匹配到，返回-1
	case n > len(s):
		return -1
	// 如果子串小于某个限定值，这里是bytealg.MaxLen
	// 这里bytealg.MaxLen是根据实际机器硬件决定的，可能是63、31等值
	// 这里的意思就是如果子串长度比较小，就不使用RabinCarp算法
	case n <= bytealg.MaxLen:
		// Use brute force when s and substr both are small
		// 如果匹配串的长度也比较小，就直接使用IndexString进行暴力匹配
		// IndexString也是汇编实现的
		if len(s) <= bytealg.MaxBruteForce {
			return bytealg.IndexString(s, substr)
		}
		// 下面的操作的意思就是先按照子串的首个字节去寻找可能的匹配点
		// 然后再进行全匹配，如果匹配点分布密集，且匹配失败的次数达到某个限定值
		// 就降级使用IndexString进行暴力匹配
		c0 := substr[0]
		c1 := substr[1]
		i := 0
		t := len(s) - n + 1
		fails := 0
		for i < t {
			// 这里就是找到下一个可匹配点
			if s[i] != c0 {
				// IndexByte is faster than bytealg.IndexString, so use it as long as
				// we're not getting lots of false positives.
				// 这里这么做的原因就是用IndexByte来寻找可匹配点比IndexString更快
				o := IndexByte(s[i+1:t], c0)
				if o < 0 {
					return -1
				}
				i += o + 1
			}
			// 如果全匹配，则返回对应的位置
			if s[i+1] == c1 && s[i:i+n] == substr {
				return i
			}
			// 否则失败次数+1
			fails++
			i++
			// Switch to bytealg.IndexString when IndexByte produces too many false positives.
			// 当失败次数达到某个限定值时，可以认为通过上面的方式寻找到多个匹配点，并且均失败了
			// 那么匹配串的特征就是可能包含众多的匹配点，直接降级使用暴力匹配即可
			if fails > bytealg.Cutover(i) {
				r := bytealg.IndexString(s[i:], substr)
				if r >= 0 {
					return r + i
				}
				return -1
			}
		}
		return -1
	}
	// 走到这里说明子串的长度不小
	// 依然先尝试寻找匹配点的方式来暴力匹配
	c0 := substr[0]
	c1 := substr[1]
	i := 0
	t := len(s) - n + 1
	fails := 0
	for i < t {
		if s[i] != c0 {
			o := IndexByte(s[i+1:t], c0)
			if o < 0 {
				return -1
			}
			i += o + 1
		}
		if s[i+1] == c1 && s[i:i+n] == substr {
			return i
		}
		i++
		fails++
		// 最后失败次数超过限定值后，改使用RabinKarp算法
		if fails >= 4+i>>4 && i < t {
			// See comment in ../bytes/bytes.go.
			// RabinKarp算法，后面会详述
			j := bytealg.IndexRabinKarp(s[i:], substr)
			if j < 0 {
				return -1
			}
			return i + j
		}
	}
	return -1
}

RabinKarp算法的核心思想有两个
1. 通过某种方式来计算字符串的hash值，并且做比较，如果相等则再进行字符比较，这样绝大部分的不匹配都会被hash值的比较过滤掉了
2. 在顺序滑动的窗口内的子串的hash结果，可以通过上一个窗口内的子串的hash结果计算得来，这样每次计算hash值就可以减少很多计算量了

举个栗子来看下go中的RabinKarp是如何计算hash的
s=123456789  substr=234  PrimeRK=16777619(这个值用来计算hash)
计算hash值的公式就是 (((s[0]*PrimePk + s[1])*PrimePk + s[2])*PrimePk + s[3])*PrimePk + ... + s[n]
也就是说，对于窗口为n的子串s[:n]，其hash值就是 hash1 = s[0]*PrimePk^(n-1) + s[1]*PrimePk^(n-2) + ... + s[n-1]
当窗口右滑一步时，窗口为n的子串s[1:n+1]，其hash值就是 hash2 = s[1]*PrimePk^(n-1) + s[2]*PrimePk^(n-2) + ... + s[n] = hash1*PrimePk - s[0]*PrimePk^n + s[n] 这样就清楚了hash2是怎么通过hash1计算得来的

这里还要说一点，go实现的RabinKarp的PrimeRK就是16777619，有些人可能会比较疑惑，如果字符串比较长，按照PrimeRK的次方来乘，是否会溢出？这个答案是肯定的，就是会溢出，不过溢出也没关系，可以认为是进行了取余操作，只要规则是一样的，相同字符串计算出来的hash值肯定是相等的


// HashStr returns the hash and the appropriate multiplicative
// factor for use in Rabin-Karp algorithm.
// 这就是计算字符串sep的hash值
// 注意这里会多余返回 PrimeRK^len(sep)，后面会有用的
func HashStr(sep string) (uint32, uint32) {
	hash := uint32(0)
	// 从sep[0]开始逐步计算叠加和乘以PrimeRK，规则同上面说的一样的
	for i := 0; i < len(sep); i++ {
		hash = hash*PrimeRK + uint32(sep[i])
	}
	var pow, sq uint32 = 1, PrimeRK
	// 这里其实就是返回PrimeRK^len(sep)
	// 不过这里是通过位移操作来进行的，主要是能减少一半的循环
	// 这里可能需要仔细想一想，规则就是遇到0就翻倍PrimeRK的次方，也就是sq*sq
	// 为啥呢，因为求PrimeRK的次方数就同等于求len(sep)，这里len(sep)用二进制表示
	// 如果是计算len(sep)，遇到0就乘以2，遇到1就叠加前面相乘的结果
	// 但这里是计算次方数，所以遇到0就得sq*sq，也就是次方数*2，遇到1就得*sq，也就是次方数相加
	for i := len(sep); i > 0; i >>= 1 {
		if i&1 != 0 {
			pow *= sq
		}
		sq *= sq
	}
	return hash, pow
}


// IndexRabinKarp uses the Rabin-Karp search algorithm to return the index of the
// first occurrence of substr in s, or -1 if not present.
// RabinKarp算法
func IndexRabinKarp(s, substr string) int {
	// Rabin-Karp search
	// 计算子串的hash和对应的PrimeRK^len(substr)
	hashss, pow := HashStr(substr)
	n := len(substr)
	var h uint32
	// 计算s[:n]的hash并进行比较
	for i := 0; i < n; i++ {
		h = h*PrimeRK + uint32(s[i])
	}
	// 如果刚好匹配，则返回
	if h == hashss && s[:n] == substr {
		return 0
	}
	// 否则循环往后挪动一位进行匹配，即窗口右滑
	for i := n; i < len(s); {
		// 利用上面计算好的h，来计算后一个窗口的子串hash值，具体规则上面有描述，这里实现是一致的
		h *= PrimeRK
		h += uint32(s[i])
		h -= pow * uint32(s[i-n])
		i++
		// 如果匹配上了返回
		if h == hashss && s[i-n:i] == substr {
			return i - n
		}
	}
	return -1
}
```
`strings`包的`strings.go`除了`Index`函数外还有很多其他的，实现都比较简单，这里不一一赘述了

### Builder
`strings.Builder`提供了byte、[]byte、rune和string的拼接方法，并且能在容量不足的情况下自动进行扩容
```go
// A Builder is used to efficiently build a string using Write methods.
// It minimizes memory copying. The zero value is ready to use.
// Do not copy a non-zero Builder.
// 定义Builder结构
// 一个byte切片和一个指向自己的指针
// 指向自己的指针主要用于防止复制
type Builder struct {
	addr *Builder // of receiver, to detect copies by value
	buf  []byte
}

// noescape hides a pointer from escape analysis.  noescape is
// the identity function but escape analysis doesn't think the
// output depends on the input. noescape is inlined and currently
// compiles down to zero instructions.
// USE CAREFULLY!
// This was copied from the runtime; see issues 23382 and 7921.
//go:nosplit
//go:nocheckptr
func noescape(p unsafe.Pointer) unsafe.Pointer {
	x := uintptr(p)
	return unsafe.Pointer(x ^ 0)
}

// 防止copy
func (b *Builder) copyCheck() {
	// 如果b.addr还未初始化
	if b.addr == nil {
		// This hack works around a failing of Go's escape analysis
		// that was causing b to escape and be heap allocated.
		// See issue 23382.
		// TODO: once issue 7921 is fixed, this should be reverted to
		// just "b.addr = b".
		// 这里同等于 b.addr=b，就是将指向自己的指针赋值给addr
		// 这样如果别的变量other复制了b的值，other.addr != &other
		// 这里noescape主要是为了解决逃逸分析失败导致b逃逸并分配到堆上，具体后续专门有文章会讲下go的内存逃逸
		b.addr = (*Builder)(noescape(unsafe.Pointer(b)))
	} else if b.addr != b {
		// 如果发现是复制的，直接panic
		panic("strings: illegal use of non-zero Builder copied by value")
	}
}

// String returns the accumulated string.
// 返回Builder拼接的字符串
func (b *Builder) String() string {
	return *(*string)(unsafe.Pointer(&b.buf))
}

// Len returns the number of accumulated bytes; b.Len() == len(b.String()).
// 同切片的len
func (b *Builder) Len() int { return len(b.buf) }

// Cap returns the capacity of the builder's underlying byte slice. It is the
// total space allocated for the string being built and includes any bytes
// already written.
// 同切片的cap
func (b *Builder) Cap() int { return cap(b.buf) }

// Reset resets the Builder to be empty.
// 重置复用，这里重置完就可以复制使用了，也可以直接继续使用
func (b *Builder) Reset() {
	b.addr = nil
	b.buf = nil
}

// grow copies the buffer to a new, larger buffer so that there are at least n
// bytes of capacity beyond len(b.buf).
// 扩容，扩容到2*cap + n
func (b *Builder) grow(n int) {
	buf := make([]byte, len(b.buf), 2*cap(b.buf)+n)
	copy(buf, b.buf)
	b.buf = buf
}

// Grow grows b's capacity, if necessary, to guarantee space for
// another n bytes. After Grow(n), at least n bytes can be written to b
// without another allocation. If n is negative, Grow panics.
// 用户可以自主扩容
func (b *Builder) Grow(n int) {
	b.copyCheck()
	if n < 0 {
		panic("strings.Builder.Grow: negative count")
	}
	// 注意这里如果未使用空间 >= n，不会触发扩容
	if cap(b.buf)-len(b.buf) < n {
		b.grow(n)
	}
}

// Write appends the contents of p to b's buffer.
// Write always returns len(p), nil.
// 拼接[]byte
func (b *Builder) Write(p []byte) (int, error) {
	b.copyCheck()
	b.buf = append(b.buf, p...)
	return len(p), nil
}

// WriteByte appends the byte c to b's buffer.
// The returned error is always nil.
// 拼接byte
func (b *Builder) WriteByte(c byte) error {
	b.copyCheck()
	b.buf = append(b.buf, c)
	return nil
}

// WriteRune appends the UTF-8 encoding of Unicode code point r to b's buffer.
// It returns the length of r and a nil error.
// 拼接rune，支持将UTF-8编码的Unicode码点拼到Builder
func (b *Builder) WriteRune(r rune) (int, error) {
	b.copyCheck()
	// Compare as uint32 to correctly handle negative runes.
	// 如果r只占用一个字节，就按照byte来处理即可
	if uint32(r) < utf8.RuneSelf {
		b.buf = append(b.buf, byte(r))
		return 1, nil
	}
	l := len(b.buf)
	// 一个UTF-8编码的Unicode字符最多占用4个字节
	// 如果容量不够，就扩容
	if cap(b.buf)-l < utf8.UTFMax {
		b.grow(utf8.UTFMax)
	}
	// 将r追加到buf中并返回r最终占用了几个字节
	n := utf8.EncodeRune(b.buf[l:l+utf8.UTFMax], r)
	// 重置buf区间
	b.buf = b.buf[:l+n]
	return n, nil
}

// WriteString appends the contents of s to b's buffer.
// It returns the length of s and a nil error.
// 拼接字符串
func (b *Builder) WriteString(s string) (int, error) {
	b.copyCheck()
	b.buf = append(b.buf, s...)
	return len(s), nil
}
```
### Reader
`strings.Reader`对应`Builder`提供了读取的方法，通过记录已读取的位移，结合切片来高效的操作，同时支持位移回退，自定义读取位置等
```go
// A Reader implements the io.Reader, io.ReaderAt, io.ByteReader, io.ByteScanner,
// io.RuneReader, io.RuneScanner, io.Seeker, and io.WriterTo interfaces by reading
// from a string.
// The zero value for Reader operates like a Reader of an empty string.
// 定义Reader结构
type Reader struct {
	// 目标字符串
	s        string
	// 当前读取起始索引
	i        int64 // current reading index
	// 前一个rune的起始索引
	prevRune int   // index of previous rune; or < 0
}

// Len returns the number of bytes of the unread portion of the
// string.
// 未读取的字节数
func (r *Reader) Len() int {
	if r.i >= int64(len(r.s)) {
		return 0
	}
	return int(int64(len(r.s)) - r.i)
}

// Size returns the original length of the underlying string.
// Size is the number of bytes available for reading via ReadAt.
// The returned value is always the same and is not affected by calls
// to any other method.
// 目标字符串字节数
func (r *Reader) Size() int64 { return int64(len(r.s)) }

// Read implements the io.Reader interface.
// 读取到[]byte中
func (r *Reader) Read(b []byte) (n int, err error) {
	// 如果已经读完
	if r.i >= int64(len(r.s)) {
		return 0, io.EOF
	}
	// 因为读取的是byte，所以这里需要将prevRune置为-1，原因后面说
	r.prevRune = -1
	// 读取到b中
	n = copy(b, r.s[r.i:])
	// 更新下次读取的起始索引
	r.i += int64(n)
	return
}

// ReadAt implements the io.ReaderAt interface.
// 从自定义起始位置读取到[]byte中
func (r *Reader) ReadAt(b []byte, off int64) (n int, err error) {
	// cannot modify state - see io.ReaderAt
	// 自定义起始位置不合法
	if off < 0 {
		return 0, errors.New("strings.Reader.ReadAt: negative offset")
	}
	// 自定义起始位置已经超出了s串的末尾
	if off >= int64(len(r.s)) {
		return 0, io.EOF
	}
	// 以off偏移作为起始位置读取到b中
	n = copy(b, r.s[off:])
	// 如果读取到的字节数小于len(b)，说明读到了s的末尾
	if n < len(b) {
		err = io.EOF
	}
	return
}

// ReadByte implements the io.ByteReader interface.
// 读取一个字节
func (r *Reader) ReadByte() (byte, error) {
	// 同样将prevRune置为-1
	// 这里只要不是读取rune，都需要将prevRune置为-1
	r.prevRune = -1
	// 如果读取到了s的末尾
	if r.i >= int64(len(r.s)) {
		return 0, io.EOF
	}
	// 读取一个字节
	b := r.s[r.i]
	// 更新下次读取的起始索引
	r.i++
	return b, nil
}

// UnreadByte implements the io.ByteScanner interface.
// 读取起始索引回退一个字节
func (r *Reader) UnreadByte() error {
	// 如果还未读取或者重置了，此时读取起始索引为s的第一个字符，无法再向前回退
	if r.i <= 0 {
		return errors.New("strings.Reader.UnreadByte: at beginning of string")
	}
	// 同上
	r.prevRune = -1
	// 回退
	r.i--
	return nil
}

// ReadRune implements the io.RuneReader interface.
// 读取一个utf-8编码的unicode字符，即rune
func (r *Reader) ReadRune() (ch rune, size int, err error) {
	// 已经读到了末尾
	if r.i >= int64(len(r.s)) {
		r.prevRune = -1
		return 0, 0, io.EOF
	}
	// 将当前读取索引标记为前一个rune的起始索引(因为从该索引处将要读取一个rune，读取之后该rune就是prevRune)
	r.prevRune = int(r.i)
	// 如果rune占用一个字节
	if c := r.s[r.i]; c < utf8.RuneSelf {
		r.i++
		return rune(c), 1, nil
	}
	// 否则动态获取一个rune，可能占用2、3、4个字节，并返回最终rune占用的字节数
	ch, size = utf8.DecodeRuneInString(r.s[r.i:])
	// 更新下次读取的起始索引(即跳过这个rune)
	r.i += int64(size)
	return
}

// UnreadRune implements the io.RuneScanner interface.
// 往前回退一个rune
func (r *Reader) UnreadRune() error {
	// 如果还未读取或已重置，无法回退
	if r.i <= 0 {
		return errors.New("strings.Reader.UnreadRune: at beginning of string")
	}
	// 如果prevRune < 0，即上一次读取的不是rune，也无法回退
	// 这就是为啥上面读取非rune的时候都需要将prevRune置为-1
	// 注意0是合法的索引位置，所以只能用负数来标识无
	if r.prevRune < 0 {
		return errors.New("strings.Reader.UnreadRune: previous operation was not ReadRune")
	}
	// 回退
	r.i = int64(r.prevRune)
	// 回退完之后prevRune又置为-1
	// 这里可以看到prevRune只能标记前一次读取的rune，所以只能回退一次，这个跟UnreadByte是不一样的
	r.prevRune = -1
	return nil
}

// Seek implements the io.Seeker interface.
// 实现接口方法io.Seeker
// 根据指定条件更改读取索引，offset是相对的位移，可正可负
func (r *Reader) Seek(offset int64, whence int) (int64, error) {
	// 同上
	r.prevRune = -1
	var abs int64
	switch whence {
	// 从头开始找
	case io.SeekStart:
		abs = offset
	// 从当前位置开始找
	case io.SeekCurrent:
		abs = r.i + offset
	// 从末尾开始找
	case io.SeekEnd:
		abs = int64(len(r.s)) + offset
	default:
		// 都不是则报错
		return 0, errors.New("strings.Reader.Seek: invalid whence")
	}
	// 非法索引
	if abs < 0 {
		return 0, errors.New("strings.Reader.Seek: negative position")
	}
	// 更新读取索引
	r.i = abs
	return abs, nil
}

// WriteTo implements the io.WriterTo interface.
// 实现接口方法io.WriterTo
// 以当前读取索引为起始，将剩余的字符串写入到w中
func (r *Reader) WriteTo(w io.Writer) (n int64, err error) {
	// 同上
	r.prevRune = -1
	// 已经到末尾了
	if r.i >= int64(len(r.s)) {
		return 0, nil
	}
	// 获取剩余的子串
	s := r.s[r.i:]
	// 写入到w
	m, err := io.WriteString(w, s)
	// 写入的字节数量非法
	if m > len(s) {
		panic("strings.Reader.WriteTo: invalid WriteString count")
	}
	// 更新读取索引
	r.i += int64(m)
	n = int64(m)
	// 检测子串是否全部写入到w中
	if m != len(s) && err == nil {
		err = io.ErrShortWrite
	}
	return
}

// Reset resets the Reader to be reading from s.
// 重置Reader
func (r *Reader) Reset(s string) { *r = Reader{s, 0, -1} }

// NewReader returns a new Reader reading from s.
// It is similar to bytes.NewBufferString but more efficient and read-only.
// 根据字符串s新建一个Reader，并返回其指针
func NewReader(s string) *Reader { return &Reader{s, 0, -1} }
```
### 总结
`strings.Builder`和`strings.Reader`都不是并发安全的，注意小心使用，同时`strings.Builder`不允许值复制，这样能避免多个`Builder`的buf切片共用同一个底层数组，造成读写冲突，不过虽然不能进行值复制，指针却可以，所以并发的问题还是会存在，使用的时候千万要小心