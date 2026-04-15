---
title: "Golang源码系列--bufio"
author: "Joker"
pubDatetime: 2022-02-17T23:56:11+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang bufio的实现源码解析"
---

### 概述
`bufio`顾名思义，就是自带buffer的io，其内部提供了`Reader`和`Writer`两个struct，通过buffer可以提升读写的性能，下面看看主要的几个读写的方法

### Reader
```go
// Reader implements buffering for an io.Reader object.
// Reader结构体
type Reader struct {
	// 缓存buffer
	buf          []byte 
	// 实现了io.Reader接口的变量，比如strings.Builder等
	rd           io.Reader // reader provided by the client
	// r代表读取标记
	// w代表写入标记
	// 这两个标记作用于buffer切片
	r, w         int       // buf read and write positions
	// 标记错误
	err          error
	// 记录读取的最后一个byte，用来做一次byte回滚
	lastByte     int // last byte read for UnreadByte; -1 means invalid
	// 记录读取的最后一个rune占用的字节数，用来做一次rune回滚
	lastRuneSize int // size of last rune read for UnreadRune; -1 means invalid
}

// 创建一个Reader
func NewReaderSize(rd io.Reader, size int) *Reader {
	// Is it already a Reader?
	// 如果rd本身就是一个Reader
	b, ok := rd.(*Reader)
	// 并且buffer也初始化过
	if ok && len(b.buf) >= size {
		return b
	}
	// buffer至少要 >= minReadBufferSize
	// minReadBufferSize = 16，即buffer最小得有16个字节的长度
	if size < minReadBufferSize {
		size = minReadBufferSize
	}
	// new一个Reader
	r := new(Reader)
	// reset进行初始化
	r.reset(make([]byte, size), rd)
	return r
}

// NewReader returns a new Reader whose buffer has the default size.
// 使用默认的buffer长度，即4096个字节
func NewReader(rd io.Reader) *Reader {
	return NewReaderSize(rd, defaultBufSize)
}

// Size returns the size of the underlying buffer in bytes.
// 计算buffer的长度
func (b *Reader) Size() int { return len(b.buf) }

// Reset discards any buffered data, resets all state, and switches
// the buffered reader to read from r.
// Calling Reset on the zero value of Reader initializes the internal buffer
// to the default size.
// 重置/初始化
func (b *Reader) Reset(r io.Reader) {
	// 初始化buffer
	if b.buf == nil {
		b.buf = make([]byte, defaultBufSize)
	}
	// 重置
	b.reset(b.buf, r)
}

// 重置，其实就是新建一个Reader
// lastByte和lastRuneSize置为-1标记无法向前回滚一个byte/一个rune
func (b *Reader) reset(buf []byte, r io.Reader) {
	*b = Reader{
		buf:          buf,
		rd:           r,
		lastByte:     -1,
		lastRuneSize: -1,
	}
}

// fill reads a new chunk into the buffer.
// fill主要用于尽量从io.Reader中读取字节到buffer
func (b *Reader) fill() {
	// Slide existing data to beginning.
	// [r,w-1]之间是buffer中还未被读取走的缓存
	// 如果r > 0则说明buffer头部已经被读取过一部分
	// 这个时候将[r,w-1]整体往前挪，覆盖掉已读取的部门
	if b.r > 0 {
		copy(b.buf, b.buf[b.r:b.w])
		b.w -= b.r
		b.r = 0
	}

	// w非法
	if b.w >= len(b.buf) {
		panic("bufio: tried to fill full buffer")
	}

	// Read new data: try a limited number of times.
	// 这里会循环尝试去io.Reader中读取数据到buffer中
	// 最多会尝试maxConsecutiveEmptyReads=100次
	for i := maxConsecutiveEmptyReads; i > 0; i-- {
		// 读取数据，写入到缓存的区间是[w, len(b.buf) - 1]
		n, err := b.rd.Read(b.buf[b.w:])
		// n非法直接panic
		if n < 0 {
			panic(errNegativeRead)
		}
		// 到这里 n>=0
		b.w += n
		// 如果发生错误
		if err != nil {
			b.err = err
			return
		}
		// 如果n>0，说明读取了一部分，至于是否填充满buffer，这个不确定也不需要确定
		if n > 0 {
			return
		}
		// 到这里说明既没发生错误，又没读到数据(如果已经读取到结尾也应该有EOF错误)
		// 循环继续尝试
	}
	// 尝试失败，返回错误
	b.err = io.ErrNoProgress
}

// 获取当前错误，并清空错误信息
func (b *Reader) readErr() error {
	err := b.err
	b.err = nil
	return err
}

// 读取n个字节
func (b *Reader) Peek(n int) ([]byte, error) {
	// n非法
	if n < 0 {
		return nil, ErrNegativeCount
	}
	// 每次读取都会更新lastByte和lastRuneSize，所以先置为-1
	b.lastByte = -1
	b.lastRuneSize = -1

	// 如果buffer没填充满并且可读区间[r, w-1]比n还小，就得先进行buffer填充
	for b.w-b.r < n && b.w-b.r < len(b.buf) && b.err == nil {
		b.fill() // b.w-b.r < len(b.buf) => buffer is not full
	}

	// 如果要读取的字节数比buffer的长度还大
	// 那就直接将buffer中未读取的数据全部返回，并给定明确的err信息
	if n > len(b.buf) {
		return b.buf[b.r:b.w], ErrBufferFull
	}

	// 0 <= n <= len(b.buf)
	var err error
	// 如果[r,w-1]的区间长度小于n
	// 同样的操作将未读取的数据全部返回
	if avail := b.w - b.r; avail < n {
		// not enough data in buffer
		n = avail
		// 注意这里会区分返回的err信息
		// 因为有可能是在上面调用b.fill方法的时候产生的错误
		err = b.readErr()
		if err == nil {
			err = ErrBufferFull
		}
	}
	return b.buf[b.r : b.r+n], err
}

// 向后丢弃n个字节，并返回实际丢弃的字节数
func (b *Reader) Discard(n int) (discarded int, err error) {
	// n非法
	if n < 0 {
		return 0, ErrNegativeCount
	}
	// 等于没丢
	if n == 0 {
		return
	}

	// 同上
	b.lastByte = -1
	b.lastRuneSize = -1

	// remain标示剩余要跳过的字节数
	remain := n
	// 这里会循环跳过
	// 即如果单次跳过后buffer已经空了并且跳过的字节数<n，就会继续填充buffer继续跳过
	for {
		// 这里取的就是区间[r,w-1]的长度即w-r
		skip := b.Buffered()
		// 如果未读取空间是空的
		// 调用b.fill填充
		if skip == 0 {
			b.fill()
			skip = b.Buffered()
		}
		// 如果未读空间足够跳过n个字节
		if skip > remain {
			skip = remain
		}
		// 跳过后调整r的位置
		b.r += skip
		// 更新剩余要跳过的字节数
		remain -= skip
		// 如果不需要跳过了，则返回
		if remain == 0 {
			return n, nil
		}
		// 如果发生了错误，则返回实际跳过的字节数和对应的错误
		if b.err != nil {
			return n - remain, b.readErr()
		}
	}
}

// 读取数据到p中，并返回实际读取的数据的字节数
func (b *Reader) Read(p []byte) (n int, err error) {
	n = len(p)
	// p是空的
	if n == 0 {
		if b.Buffered() > 0 {
			return 0, nil
		}
		return 0, b.readErr()
	}
	// 如果buffer是空的
	if b.r == b.w {
		// 有错误
		if b.err != nil {
			return 0, b.readErr()
		}
		// 要读取的字节数比buffer的长度大
		if len(p) >= len(b.buf) {
			// Large read, empty buffer.
			// Read directly into p to avoid copy.
			// 也就是说如果通过fill填满buffer，也会立即将buffer的数据全部读取到p中
			// 没必要倒两手，直接从io.Reader读到p
			n, b.err = b.rd.Read(p)
			// n非法，panic
			if n < 0 {
				panic(errNegativeRead)
			}
			// 更新lastByte和lastRuneSize
			if n > 0 {
				b.lastByte = int(p[n-1])
				b.lastRuneSize = -1
			}
			// 返回
			return n, b.readErr()
		}
		// One read.
		// Do not use b.fill, which will loop.
		// 到这里就会先读取到buffer中
		// 也就是说本次不会把buffer中的数据全部读完，后续再读可以直接从buffer读，就不用从io.Reader中读了，速度自然就快了
		b.r = 0
		b.w = 0
		// 这里没有用fill去操作，原因是这是由使用方触发的一次读取
		// 成功就成功，失败就失败，保证读取速度
		n, b.err = b.rd.Read(b.buf)
		if n < 0 {
			panic(errNegativeRead)
		}
		if n == 0 {
			return 0, b.readErr()
		}
		b.w += n
	}

	// copy as much as we can
	// Note: if the slice panics here, it is probably because
	// the underlying reader returned a bad count. See issue 49795.
	// 到这里就将buffer中的可读取的数据读取到p中，可能填满p也可能填不满p，这都是正常的
	// 使用的时候要注意，这里如果p没有被填满，并不代表读取完了io.Reader中的数据，只是读取完了buffer中的数据
	n = copy(p, b.buf[b.r:b.w])
	b.r += n
	b.lastByte = int(b.buf[b.r-1])
	b.lastRuneSize = -1
	return n, nil
}
```
`Reader`还实现了其他的一些方法，这里不一一详细说了，目的主要是为了介绍下`io.Reader`在有buffer的辅助下是怎么加快读性能以及如何管理buffer的，同时介绍下`Reader`的设计思路和常用/底层的方法

### Writer
```go
// Writer结构
type Writer struct {
	// 错误信息
	err error
	// buffer
	buf []byte
	// 写入位置
	n   int
	// 实现了io.Writer接口的变量
	wr  io.Writer
}

// 创建一个Writer
func NewWriterSize(w io.Writer, size int) *Writer {
	// Is it already a Writer?
	// 如果自身就是Writer
	b, ok := w.(*Writer)
	// 并且buffer已经初始化了
	if ok && len(b.buf) >= size {
		return b
	}
	// 如果buffer没有初始化
	if size <= 0 {
		size = defaultBufSize
	}
	// 构造Writer
	// 默认n=0，即从buffer[0]开始写入
	return &Writer{
		buf: make([]byte, size),
		wr:  w,
	}
}

// 使用defaultBufSize创建Writer
func NewWriter(w io.Writer) *Writer {
	return NewWriterSize(w, defaultBufSize)
}

// 获取buffer的长度
func (b *Writer) Size() int { return len(b.buf) }

// Reset discards any unflushed buffered data, clears any error, and
// resets b to write its output to w.
// Calling Reset on the zero value of Writer initializes the internal buffer
// to the default size.
// 重置/初始化Writer
func (b *Writer) Reset(w io.Writer) {
	// 初始化buffer
	if b.buf == nil {
		b.buf = make([]byte, defaultBufSize)
	}
	b.err = nil
	b.n = 0
	b.wr = w
}


// Flush writes any buffered data to the underlying io.Writer.
// 将buffer的数据刷到io.Writer中
func (b *Writer) Flush() error {
	// 如果有错误
	if b.err != nil {
		return b.err
	}
	// 如果buffer为空
	if b.n == 0 {
		return nil
	}
	// 将buffer的数据刷到io.Writer中
	// 这里只需要维护buffer的写入位置n即可，因为起始位置始终都是0
	// 这点不同于Reader
	n, err := b.wr.Write(b.buf[0:b.n])
	// 如果未发生错误并且buffer中的数据没有全部刷到io.Writer中
	if n < b.n && err == nil {
		err = io.ErrShortWrite
	}
	// 如果发生错误
	if err != nil {
		// buffer未刷空
		if n > 0 && n < b.n {
			// 将未刷的数据往前挪覆盖刷过的数据
			// 这就保证了每次起始位置都是0，也是为什么只需要维护一个n的原因
			copy(b.buf[0:b.n-n], b.buf[n:b.n])
		}
		// 更新写入位置
		b.n -= n
		b.err = err
		return err
	}
	// 到这里说明err == nil && n = b.n
	// 也就是buffer刷空了
	// 重新开始从buffer[0]写入
	b.n = 0
	return nil
}


// Available returns how many bytes are unused in the buffer.
// 返回buffer中可写入的字节数
func (b *Writer) Available() int { return len(b.buf) - b.n }

// AvailableBuffer returns an empty buffer with b.Available() capacity.
// This buffer is intended to be appended to and
// passed to an immediately succeeding Write call.
// The buffer is only valid until the next write operation on b.
// 返回buffer中可写入的切片区间
func (b *Writer) AvailableBuffer() []byte {
	return b.buf[b.n:][:0]
}

// Buffered returns the number of bytes that have been written into the current buffer.
// 返回b.n，即已写入到buffer的字节数
func (b *Writer) Buffered() int { return b.n }

// Write writes the contents of p into the buffer.
// It returns the number of bytes written.
// If nn < len(p), it also returns an error explaining
// why the write is short.
// 将字节切片p写入到Writer中，并返回实际写入的字节数
func (b *Writer) Write(p []byte) (nn int, err error) {
	// 如果buffer没有足够的空间放下p
	for len(p) > b.Available() && b.err == nil {
		var n int
		// 如果buffer是空的
		// 加上前面的条件说明，len(p) > len(b.buf)
		// 那就不倒到buffer了，直接写到io.Writer中
		if b.Buffered() == 0 {
			// Large write, empty buffer.
			// Write directly from p to avoid copy.
			n, b.err = b.wr.Write(p)
		} else {
			// 否则就将p的一部分写到buffer中，然后触发Flush将buffer整个刷到io.Writer中
			n = copy(b.buf[b.n:], p)
			b.n += n
			b.Flush()
		}
		// 更新统计写入的字节数
		nn += n
		// 更新p
		p = p[n:]
	}
	// 如果发生错误
	if b.err != nil {
		return nn, b.err
	}
	// 到这里说明buffer已经有足够的空间存在p了
	// 不用在触发Flush，等下次满的时候再触发，减少io.Writer的次数，加快写性能
	// 所以这里需要注意，Write并不一定会把写入的数据都刷到io.Writer中，所以如果想要马上写入到io.Writer，记得手动调用一次Flush
	n := copy(b.buf[b.n:], p)
	b.n += n
	nn += n
	return nn, nil
}

// WriteString writes a string.
// It returns the number of bytes written.
// If the count is less than len(s), it also returns an error explaining
// why the write is short.
// 将字符串s写入到Writer中
func (b *Writer) WriteString(s string) (int, error) {
	nn := 0
	// 同样的操作，判断buffer是否有空间存入s
	for len(s) > b.Available() && b.err == nil {
		// 这里没有像Write一样直接将s写入到io.Writer中
		// 个中原因能还是需要先将s转成[]byte，这跟将s拷贝到buffer中几乎是一样的
		// 所以就不需要再细化判断条件搞得还复杂了
		n := copy(b.buf[b.n:], s)
		b.n += n
		nn += n
		s = s[n:]
		b.Flush()
	}
	// 下面基本跟Write也是一样的
	if b.err != nil {
		return nn, b.err
	}
	n := copy(b.buf[b.n:], s)
	b.n += n
	nn += n
	return nn, nil
}
```
`Writer`还实现了一些其他的方法，这里也不多说了，原理清楚了即可

### ReadWriter
```go
// ReadWriter stores pointers to a Reader and a Writer.
// It implements io.ReadWriter.
type ReadWriter struct {
	*Reader
	*Writer
}

// NewReadWriter allocates a new ReadWriter that dispatches to r and w.
func NewReadWriter(r *Reader, w *Writer) *ReadWriter {
	return &ReadWriter{r, w}
}
```
`bufio`还提供了一个同时包含`Reader`和`Writer`的结构体以及对应的创建方法

### 总结
`bufio`通过buffer来减少操作`io.Reader`和`io.Writer`的次数，从而提升性能，这种优化方式比比皆是，比如底层的cpu的缓存，应用层的mysql缓存等等