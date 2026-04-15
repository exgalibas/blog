---
title: "Golang源码系列--buffer"
author: "Joker"
pubDatetime: 2018-05-31T11:20:43+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang buffer的实现源码解析"
---

#### 功能
buffer.go属于bytes包，主要实现了一个可伸缩的存储byte的分片，支持写入读取byte、string和rune(UTF-8编码的字符)，支持从io.Reader中读取byte到分片，也支持从分片中读取byte到io.Writer，支持部分读取操作的回滚

#### 源码解析
```go
type Buffer struct {
    // 分片，内容存储
    buf       []byte
    // 读取进度标记，表示已经读取了off个bytes
    off       int
    // 用于初始化小分片，避免分配步骤
    bootstrap [64]byte
    // 标记最后一次的操作，用于判断是否可以回滚部分读取操作
    lastRead  readOp
}

type readOp int8

// 操作标志
const (
    opRead      readOp = -1 // 所有其他的读取操作
    opInvalid   readOp = 0  // 非读取操作
    opReadRune1 readOp = 1  // 读取了1byte
    opReadRune2 readOp = 2  // .....2byte
    opReadRune3 readOp = 3  // .....3byte
    opReadRune4 readOp = 4  // .....4byte
)

// 错误提示信息
var ErrTooLarge = errors.New("bytes.Buffer: too large")
var errNegativeRead = errors.New("bytes.Buffer: reader returned negative count from Read")

// 最大有符号整数值
const maxInt = int(^uint(0) >> 1)
/**
const MaxUint = ^uint(0)
const MinUint = 0
const MaxInt = int(MaxUint >> 1)
const MinInt = -MaxInt - 1

uint8  : 0 to 255
uint16 : 0 to 65535
uint32 : 0 to 4294967295
uint64 : 0 to 18446744073709551615
int8   : -128 to 127
int16  : -32768 to 32767
int32  : -2147483648 to 2147483647
int64  : -9223372036854775808 to 9223372036854775807
 */


// 获取buf中未读取的部分，返回分片
func (b *Buffer) Bytes() []byte { return b.buf[b.off:] }


// 获取buf中未读取的部分，返回字符串
func (b *Buffer) String() string {
    if b == nil {
        // Special case, useful in debugging.
        return "<nil>"
    }
    return string(b.buf[b.off:])
}

// 判断buf中是否还有未读取的，返回布尔值
func (b *Buffer) empty() bool { return len(b.buf) <= b.off }


// 获取buf中未读取的byte数
func (b *Buffer) Len() int { return len(b.buf) - b.off }


// 获取buf的容量
func (b *Buffer) Cap() int { return cap(b.buf) }


// 截取buf，保留未读取部分的顺序n个bytes，n为0时走初始化
func (b *Buffer) Truncate(n int) {
    if n == 0 {
        b.Reset()
        return
    }
    b.lastRead = opInvalid
    if n < 0 || n > b.Len() {
        panic("bytes.Buffer: truncation out of range")
    }
    b.buf = b.buf[:b.off+n]
}


// 置空buf，len设置为0，依然保留置空前的cap以备后用，等同于Truncate(0）
func (b *Buffer) Reset() {
    b.buf = b.buf[:0]
    b.off = 0
    b.lastRead = opInvalid
}


// 当前分片容量足够，直接扩充，这里不会清除掉已读部分
// 这个方法是为了提升效率添加上来的
func (b *Buffer) tryGrowByReslice(n int) (int, bool) {
    if l := len(b.buf); n <= cap(b.buf)-l {
        b.buf = b.buf[:l+n]
        return l, true
    }
    return 0, false
}

// 核心方法，扩充buf
func (b *Buffer) grow(n int) int {
    m := b.Len()

    // buf已经写入过bytes并全部已读，直接初始化为空分片(已读取部分为无用部分，占用缓存没必要了)
    if m == 0 && b.off != 0 {
        b.Reset()
    }

    // 判断buf是否容量充足，直接reslice扩充，返回扩充前buf的长度
    if i, ok := b.tryGrowByReslice(n); ok {
        return i
    }

    // 如果buf为nil，判断是否可以使用备用的bootstrap
    if b.buf == nil && n <= len(b.bootstrap) {
        b.buf = b.bootstrap[:n]
        return 0
    }
    c := cap(b.buf)
    // 保证buf的容量至少是扩充后长度的两倍，扩充后的长度 = 未读取部分的长度 + n (能用减法就不要用加法，避免溢出)
    if n <= c/2-m {
        // 从buf中未读取部分到长度末尾进行复制
        // 丢弃已读取部分
        copy(b.buf, b.buf[b.off:])
    } else if c > maxInt-c-n {
        // 保证2*c+n不溢出，使用减法
        panic(ErrTooLarge)
    } else {
        // 当m+n > c/2时，重新分配，大小规则是2*c+n
        buf := makeSlice(2*c + n)
        // 复制未读取部分
        copy(buf, b.buf[b.off:])
        // 指向新分配的缓存
        b.buf = buf
    }
    
    // 抛弃了已读取部分，所以读取标志位归0
    b.off = 0
    // 扩充后的长度
    b.buf = b.buf[:m+n]
    return m
}


// grow的wrapper，做了参数检查
// 与grow不同的是，Grow不扩充长度，只是保证容量足够再写入n bytes
func (b *Buffer) Grow(n int) {
    if n < 0 {
        panic("bytes.Buffer.Grow: negative count")
    }
    // 这个m可以看看grow方法的几个return的地方，做到了一致，都是代表扩充之后不包含n的长度
    m := b.grow(n)
    b.buf = b.buf[:m]
}


// 向分片缓存末尾追加写入bite分片
func (b *Buffer) Write(p []byte) (n int, err error) {
    b.lastRead = opInvalid
    // 这里有必要吗？grow不是会针对这种情况处理吗？为什么要调用两遍
    // 这里开始是没有的，算一个优化吧，解释 https://go-review.googlesource.com/c/go/+/42813
    // 简单的说就是很多情况下我们不需要重新分配buf，只需要reslice旧的就可以了，没必要通过grow调用，增加消耗
    // 后面很多方法都有这种处理，原因一致
    m, ok := b.tryGrowByReslice(len(p))
    if !ok {
        m = b.grow(len(p))
    }
    return copy(b.buf[m:], p), nil
}


// 向分片缓存末尾追加写入字符串(字符串和分片之间可以转换)
func (b *Buffer) WriteString(s string) (n int, err error) {
    b.lastRead = opInvalid
    m, ok := b.tryGrowByReslice(len(s))
    if !ok {
        m = b.grow(len(s))
    }
    return copy(b.buf[m:], s), nil
}


// 最小的读入byte数
const MinRead = 512


// 从io.Reader中读入数据到buf中
func (b *Buffer) ReadFrom(r io.Reader) (n int64, err error) {
    b.lastRead = opInvalid
    for {
        // 检测目前的缓存长度是否够用并进行相应调整，返回调整之前的长度值
        i := b.grow(MinRead)
        // 向分片中写入数据，注意这里用的长度是cap(b.buf)，是buf的容量，就是一次尽可能多的写入进去
        // 而前面的b.grow(MinRead)就是保证每次至少能写入MinRead的数据
        m, e := r.Read(b.buf[i:cap(b.buf)])
        if m < 0 {
            panic(errNegativeRead)
        }

        // 单次写入数据之后分片的长度
        b.buf = b.buf[:i+m]

        // 计数写入的bytes数
        n += int64(m)

        // 全部写完
        if e == io.EOF {
            return n, nil // e is EOF, so return nil explicitly
        }

        // 写入出错，返回写入的bytes和error
        if e != nil {
            return n, e
        }
    }
}


// 分配缓存
func makeSlice(n int) []byte {
    defer func() {
        // 捕获panic，自行处理
        if recover() != nil {
            panic(ErrTooLarge)
        }
    }()
    return make([]byte, n)
}


// 从buf中读取未读取的bytes到io.Writer中
func (b *Buffer) WriteTo(w io.Writer) (n int64, err error) {
    b.lastRead = opInvalid
    // 判断是否还有未读取的
    if nBytes := b.Len(); nBytes > 0 {
        // 从b.off开始，读取未读取的部分
        m, e := w.Write(b.buf[b.off:])
        // m只可能介于(0,nBytes]
        if m > nBytes {
            panic("bytes.Buffer.WriteTo: invalid Write count")
        }
        // 更新读取标志位
        b.off += m
        // 更新bytes计数并装换为int64
        n = int64(m)
        // 有错误，返回已读bytes数和error
        if e != nil {
            return n, e
        }
        
        // 这里注意下，就算e == nil也不能贸然认为成功了
        // io.Write的定义中明确说明如果没有任何错误，返回的必然是len([]byte)，这里就是b.Len()=nBytes
        // 所以还需要判断m是否等于nBytes，如果不等于就是读取中断并且没能返回具体的错误，这里使用io.ErrShortWrite错误来兜底
        if m != nBytes {
            return n, io.ErrShortWrite
        }
    }
    
    // 如果一切正常，那么buf的所有bytes都被读取完了，没必要再保留了
    // 节约内存，初始化为空
    b.Reset()
    return n, nil
}


// 追加一个byte到buf中，行为类似上面的Write方法
func (b *Buffer) WriteByte(c byte) error {
    b.lastRead = opInvalid
    m, ok := b.tryGrowByReslice(1)
    if !ok {
        m = b.grow(1)
    }
    b.buf[m] = c
    return nil
}


// 向buf中追加一个rune类型的数据
func (b *Buffer) WriteRune(r rune) (n int, err error) {
    // 小于128，ascii的编码范围，当做一个字节处理即可，从int32强制转换为uint8
    if r < utf8.RuneSelf {
        b.WriteByte(byte(r))
        return 1, nil
    }
    b.lastRead = opInvalid
    // 单个rune是int32类型，4个bytes，utf8.UTFMax=4
    m, ok := b.tryGrowByReslice(utf8.UTFMax)
    if !ok {
        m = b.grow(utf8.UTFMax)
    }
    // 写入并返回写入的bytes数
    n = utf8.EncodeRune(b.buf[m:m+utf8.UTFMax], r)
    // 更新buf长度，这一步是必须的
    // 虽然grow扩充的时候更新了buf的长度，但是是按照utf8.UTFMax=4更新的
    // 看utf8.EncodeRune的实现，不一定会写入4个bytes
    b.buf = b.buf[:m+n]
    return n, nil
}


// 从buf中读取len(p)个bytes到p中
func (b *Buffer) Read(p []byte) (n int, err error) {
    b.lastRead = opInvalid
    if b.empty() {
        // 无未读，触发置空逻辑
        b.Reset()
        if len(p) == 0 {
            return 0, nil
        }
        return 0, io.EOF
    }
    // 写入p
    n = copy(p, b.buf[b.off:])
    // 更新buf的读取标志
    b.off += n
    if n > 0 {
        // 读取成功，设置标志
        b.lastRead = opRead
    }
    return n, nil
}


// 从buf中读取未读取部分中的至少n个bytes，返回分片
func (b *Buffer) Next(n int) []byte {
    b.lastRead = opInvalid
    m := b.Len()
    // n超过了未读取byte数，全部读出
    if n > m {
        n = m
    }
    // 这里如果n < 0，编译过不去，所以不用担心会破坏未读标志b.off
    data := b.buf[b.off : b.off+n]
    // 更新未读标志
    b.off += n
    // n=0不用设置读取标志了
    if n > 0 {
        b.lastRead = opRead
    }
    return data
}


// 读取buf未读部分的第一个byte
func (b *Buffer) ReadByte() (byte, error) {
    if b.empty() {
        // 无未读，返回EOF错误
        b.Reset()
        return 0, io.EOF
    }
    // 读取第一个未读byte，即b.off索引的元素
    c := b.buf[b.off]
    // 更新读取标志
    b.off++
    b.lastRead = opRead
    return c, nil
}


// 从buf未读部分中读取utf-8编码的bytes，如果不是正确的utf-8编码的，返回首个byte
func (b *Buffer) ReadRune() (r rune, size int, err error) {
    if b.empty() {
        // Buffer is empty, reset to recover space.
        // 无未读，触发置空逻辑
        b.Reset()
        return 0, 0, io.EOF
    }
    c := b.buf[b.off]
    // ascii范围内，单字节处理
    if c < utf8.RuneSelf {
        b.off++
        b.lastRead = opReadRune1
        return rune(c), 1, nil
    }
    // 调用DecodeRune处理utf-8-encoded bytes
    // 返回
    r, n := utf8.DecodeRune(b.buf[b.off:])
    // 更新读取标志
    b.off += n
    // 设置标志，类型转换为一致
    b.lastRead = readOp(n)
    return r, n, nil
}


// 回滚readRune读取的byte数
func (b *Buffer) UnreadRune() error {
    // 检查标志，判断是否可以回滚读取操作
    // 如果标志是opInvalid，那么最后一次操作就不是读取，可能触发置空逻辑或者重新修改分片逻辑，已读取部分会丢失
    if b.lastRead <= opInvalid {
        return errors.New("bytes.Buffer: UnreadRune: previous operation was not a successful ReadRune")
    }
    // 判断读取byte数是否大于要回滚的byte数
    if b.off >= int(b.lastRead) {
        b.off -= int(b.lastRead)
    }
    // 设置标志
    b.lastRead = opInvalid
    return nil
}


// 回滚readByte读取的单个byte
func (b *Buffer) UnreadByte() error {
    if b.lastRead == opInvalid {
        return errors.New("bytes.Buffer: UnreadByte: previous operation was not a successful read")
    }
    b.lastRead = opInvalid
    // 判断读取数是否大于0，保证健壮性
    if b.off > 0 {
        b.off--
    }
    return nil
}


// 对外的方法，功能同readSlice一致
func (b *Buffer) ReadBytes(delim byte) (line []byte, err error) {
    slice, err := b.readSlice(delim)
    // return a copy of slice. The buffer's backing array may
    // be overwritten by later calls.
    // 这里因为readSlice返回的是原buf的分片，进行copy避免buf后续的变动影响line
    line = append(line, slice...)
    return line, err
}


// 顺序读取buf中未读取部分直到delim首次出现的位置(包含)，直到buf末尾，注意这里返回的是分片
func (b *Buffer) readSlice(delim byte) (line []byte, err error) {
    // 搜索首次出现的位置
    i := IndexByte(b.buf[b.off:], delim)
    end := b.off + i + 1
    if i < 0 {
        // 没找到delim，全部读出
        end = len(b.buf)
        err = io.EOF
    }
    line = b.buf[b.off:end]
    // 更新读取标志
    b.off = end
    b.lastRead = opRead
    return line, err
}


// 对外方法，功能同ReadSlice，只是转换成了字符串
func (b *Buffer) ReadString(delim byte) (line string, err error) {
    slice, err := b.readSlice(delim)
    return string(slice), err
}


// 新建并使用分片初始化一个buf
func NewBuffer(buf []byte) *Buffer { return &Buffer{buf: buf} }


// 新建并使用字符串初始化一个buf
func NewBufferString(s string) *Buffer {
    return &Buffer{buf: []byte(s)}
}

// 按照bytes_decl.go中对IndexByte的定义自己实现的方法
// 这样所有的代码就可以复制到自己的工程的某个包里面单独使用调试修改...
// 返回c在s中首次出现的位置索引，如果没有出现过，返回-1
func IndexByte(s []byte, c byte) (index int) {
    index = -1
    for i, v := range s {
        if v == c {
            index = i
        }
    }
    return
}
```

#### 说明
buffer.go通过严格控制读取标志buf.off来区分已读取部分和未读取部分，扩充的方式有三种，分别是增加分片长度(容量充足的情况下)、使用结构中已有的数组bootstrap(分片未初始化的情况下)和重新分配分片.这里我自己实现了IndexByte方法，这样整个代码就可以在不import bytes的情况下直接在工程中调试使用了，至于用法这里就不赘述了，看懂了源码难道还不会用吗？