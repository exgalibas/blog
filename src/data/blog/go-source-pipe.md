---
title: "Golang源码系列--pipe"
author: "Joker"
pubDatetime: 2022-02-18T23:56:52+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang pipe的实现源码解析"
---

### 概述
io包中通过pipe实现了管道

### 源码
```go
// onceError is an object that will only store an error once.
// 加锁的错误信息
// 保证并发读写的安全
type onceError struct {
	sync.Mutex // guards following
	err        error
}

// 加锁防止并发读写
func (a *onceError) Store(err error) {
	a.Lock()
	defer a.Unlock()
	if a.err != nil {
		return
	}
	a.err = err
}

func (a *onceError) Load() error {
	a.Lock()
	defer a.Unlock()
	return a.err
}

// ErrClosedPipe is the error used for read or write operations on a closed pipe.
var ErrClosedPipe = errors.New("io: read/write on closed pipe")

// A pipe is the shared pipe structure underlying PipeReader and PipeWriter.
// pipe管道结构，注意是小写，外部不可见
type pipe struct {
	// 锁
	wrMu sync.Mutex // Serializes Write operations
	// 通道channel，无缓存
	wrCh chan []byte
	// 记录最近一次读取出的字节数，也是无缓存channel
	rdCh chan int

	// 保证close(done)只会执行一次，多次会panic
	// sync.Once之前源码解析过
	once sync.Once // Protects closing done
	// 用来标记pipe是否关闭
	done chan struct{}
	// 记录读写错误信息
	rerr onceError
	werr onceError
}

// 从pipe读取数据到b
func (p *pipe) Read(b []byte) (n int, err error) {
	// 检查一次pipe是否关闭
	select {
	case <-p.done:
		return 0, p.readCloseError()
	default:
	}

	// 要么从wrCh读取出数据
	// 要么done被close，否则会阻塞等待
	select {
	// 从channel中读取数据
	case bw := <-p.wrCh:
		// rdCh记录实际读取的字节数
		// 因为b可能比bw小,所以read并不一定会把bw全部读出
		nr := copy(b, bw)
		p.rdCh <- nr
		return nr, nil
	// 判断pipe是否关闭
	case <-p.done:
		return 0, p.readCloseError()
	}
}

// 返回一个读取已关闭pipe的错误
func (p *pipe) readCloseError() error {
	rerr := p.rerr.Load()
	if werr := p.werr.Load(); rerr == nil && werr != nil {
		return werr
	}
	return ErrClosedPipe
}

// 读端主动关闭pipe
func (p *pipe) CloseRead(err error) error {
	if err == nil {
		err = ErrClosedPipe
	}
	p.rerr.Store(err)
	p.once.Do(func() { close(p.done) })
	return nil
}

// 将b的数据写入pipe
func (p *pipe) Write(b []byte) (n int, err error) {
	// 同样先检查pipe是否关闭
	select {
	case <-p.done:
		return 0, p.writeCloseError()
	default:
		// 注意如果pipe未关闭，继续执行后面之前需要加锁，至于为什么，往下看
		p.wrMu.Lock()
		defer p.wrMu.Unlock()
	}

	// 不管b是不是空的，至少保证执行一次，原因就是解除正在等待的reader的阻塞状态
	// 第一次运行之后，后面就判断b是否已经全部通过pipe写入
	for once := true; once || len(b) > 0; once = false {
		select {
		// 将b写入到wrCh中
		// 因为wrCh没有缓存
		// 如果没有reader在等待读，就跳过这个case
		// 如果有reader在等待读，就将p直接传递给reader(具体实现可以看之前的channel源码解析)
		case p.wrCh <- b:
			// 这里rdCh发挥作用了
			// 到这一步，reader已经读取完了
			// 通过获取reader实际读取到的字来判断p是否被读取完了
			// 如果没有读取完，还会继续往pipe中写，直到下次reader继续读取
			// 这里也能解答为何上面会上锁，因为p可能分两次写pipe，但是对于写端是黑盒的，写端认为是一次原子写入
			nw := <-p.rdCh
			// b有可能没有读完
			b = b[nw:]
			n += nw
		// 如果pipe关闭了，就返回实际写入到字节数和错误信息
		case <-p.done:
			return n, p.writeCloseError()
		}
	}
	return n, nil
}

func (p *pipe) writeCloseError() error {
	werr := p.werr.Load()
	if rerr := p.rerr.Load(); werr == nil && rerr != nil {
		return rerr
	}
	return ErrClosedPipe
}

// 写端主动关闭pipe
// 除了错误信息不一样，其他动作跟读端主动关闭pipe是一致的
func (p *pipe) CloseWrite(err error) error {
	if err == nil {
		err = EOF
	}
	p.werr.Store(err)
	p.once.Do(func() { close(p.done) })
	return nil
}

// A PipeReader is the read half of a pipe.
// 后面分别使用PipeReader和PipeWriter来包装pipe的读写能力
// 即读端和写端，读端只提供读的能力，写端只提供写的能力
type PipeReader struct {
	p *pipe
}

// Read implements the standard Read interface:
// it reads data from the pipe, blocking until a writer
// arrives or the write end is closed.
// If the write end is closed with an error, that error is
// returned as err; otherwise err is EOF.
func (r *PipeReader) Read(data []byte) (n int, err error) {
	return r.p.Read(data)
}

// Close closes the reader; subsequent writes to the
// write half of the pipe will return the error ErrClosedPipe.
func (r *PipeReader) Close() error {
	return r.CloseWithError(nil)
}

// CloseWithError closes the reader; subsequent writes
// to the write half of the pipe will return the error err.
//
// CloseWithError never overwrites the previous error if it exists
// and always returns nil.
func (r *PipeReader) CloseWithError(err error) error {
	return r.p.CloseRead(err)
}

// A PipeWriter is the write half of a pipe.
type PipeWriter struct {
	p *pipe
}

// Write implements the standard Write interface:
// it writes data to the pipe, blocking until one or more readers
// have consumed all the data or the read end is closed.
// If the read end is closed with an error, that err is
// returned as err; otherwise err is ErrClosedPipe.
func (w *PipeWriter) Write(data []byte) (n int, err error) {
	return w.p.Write(data)
}

// Close closes the writer; subsequent reads from the
// read half of the pipe will return no bytes and EOF.
func (w *PipeWriter) Close() error {
	return w.CloseWithError(nil)
}

// CloseWithError closes the writer; subsequent reads from the
// read half of the pipe will return no bytes and the error err,
// or EOF if err is nil.
//
// CloseWithError never overwrites the previous error if it exists
// and always returns nil.
func (w *PipeWriter) CloseWithError(err error) error {
	return w.p.CloseWrite(err)
}

// Pipe creates a synchronous in-memory pipe.
// It can be used to connect code expecting an io.Reader
// with code expecting an io.Writer.
//
// Reads and Writes on the pipe are matched one to one
// except when multiple Reads are needed to consume a single Write.
// That is, each Write to the PipeWriter blocks until it has satisfied
// one or more Reads from the PipeReader that fully consume
// the written data.
// The data is copied directly from the Write to the corresponding
// Read (or Reads); there is no internal buffering.
//
// It is safe to call Read and Write in parallel with each other or with Close.
// Parallel calls to Read and parallel calls to Write are also safe:
// the individual calls will be gated sequentially.
// 构造一个包含读端和写端的pipe
// 通过Pipe获得一个可以立即使用的pipe
func Pipe() (*PipeReader, *PipeWriter) {
	p := &pipe{
		wrCh: make(chan []byte),
		rdCh: make(chan int),
		done: make(chan struct{}),
	}
	return &PipeReader{p}, &PipeWriter{p}
}
```

### 总结
pipe最核心还是通过channel来进行通信，利用无缓冲channel实现了读端和写端的阻塞等待和唤醒，同时通过记录读取字节数和锁实现了顺序流式数据传递的管道，并对外提供了构建pipe的能力，支持开箱即用