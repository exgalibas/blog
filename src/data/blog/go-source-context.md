---
title: "Golang源码系列--context"
author: "Joker"
pubDatetime: 2022-01-12T15:10:09+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang context的实现源码解析"
---

### 概述
`context`主要用于跨多个`Goroutine`设置截止时间、同步信号、传递上下文请求值

### 源码解析
```go
// Copyright 2014 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package context defines the Context type, which carries deadlines,
// cancellation signals, and other request-scoped values across API boundaries
// and between processes.
//
// Incoming requests to a server should create a Context, and outgoing
// calls to servers should accept a Context. The chain of function
// calls between them must propagate the Context, optionally replacing
// it with a derived Context created using WithCancel, WithDeadline,
// WithTimeout, or WithValue. When a Context is canceled, all
// Contexts derived from it are also canceled.
//
// The WithCancel, WithDeadline, and WithTimeout functions take a
// Context (the parent) and return a derived Context (the child) and a
// CancelFunc. Calling the CancelFunc cancels the child and its
// children, removes the parent's reference to the child, and stops
// any associated timers. Failing to call the CancelFunc leaks the
// child and its children until the parent is canceled or the timer
// fires. The go vet tool checks that CancelFuncs are used on all
// control-flow paths.
//
// Programs that use Contexts should follow these rules to keep interfaces
// consistent across packages and enable static analysis tools to check context
// propagation:
//
// Do not store Contexts inside a struct type; instead, pass a Context
// explicitly to each function that needs it. The Context should be the first
// parameter, typically named ctx:
//
// 	func DoSomething(ctx context.Context, arg Arg) error {
// 		// ... use ctx ...
// 	}
//
// Do not pass a nil Context, even if a function permits it. Pass context.TODO
// if you are unsure about which Context to use.
//
// Use context Values only for request-scoped data that transits processes and
// APIs, not for passing optional parameters to functions.
//
// The same Context may be passed to functions running in different goroutines;
// Contexts are safe for simultaneous use by multiple goroutines.
//
// See https://blog.golang.org/context for example code for a server that uses
// Contexts.
package context

import (
	"errors"
	"internal/reflectlite"
	"sync"
	"sync/atomic"
	"time"
)

// A Context carries a deadline, a cancellation signal, and other values across
// API boundaries.
//
// Context's methods may be called by multiple goroutines simultaneously.
// Context接口定义了四个方法
type Context interface {
	// Deadline returns the time when work done on behalf of this context
	// should be canceled. Deadline returns ok==false when no deadline is
	// set. Successive calls to Deadline return the same results.
    // 获取截止时间
	Deadline() (deadline time.Time, ok bool)

	// Done returns a channel that's closed when work done on behalf of this
	// context should be canceled. Done may return nil if this context can
	// never be canceled. Successive calls to Done return the same value.
	// The close of the Done channel may happen asynchronously,
	// after the cancel function returns.
	//
	// WithCancel arranges for Done to be closed when cancel is called;
	// WithDeadline arranges for Done to be closed when the deadline
	// expires; WithTimeout arranges for Done to be closed when the timeout
	// elapses.
	//
	// Done is provided for use in select statements:
	//
	//  // Stream generates values with DoSomething and sends them to out
	//  // until DoSomething returns an error or ctx.Done is closed.
	//  func Stream(ctx context.Context, out chan<- Value) error {
	//  	for {
	//  		v, err := DoSomething(ctx)
	//  		if err != nil {
	//  			return err
	//  		}
	//  		select {
	//  		case <-ctx.Done():
	//  			return ctx.Err()
	//  		case out <- v:
	//  		}
	//  	}
	//  }
	//
	// See https://blog.golang.org/pipelines for more examples of how to use
	// a Done channel for cancellation.
    // 获取信号通道，用于判断父Context是否已取消
    // <-chan struct{} 这里struct{}是常用的占位手法，不占用内存空间
    // 因为是只读通道，当该通道关闭时，所有的子Context就可以结合select来及时获得通知，从而达到层层广播的效果，类似多米诺骨牌
	Done() <-chan struct{}

	// If Done is not yet closed, Err returns nil.
	// If Done is closed, Err returns a non-nil error explaining why:
	// Canceled if the context was canceled
	// or DeadlineExceeded if the context's deadline passed.
	// After Err returns a non-nil error, successive calls to Err return the same error.
    // 通道取消的错误信息，用于区分是哪种原因取消了
	Err() error

	// Value returns the value associated with this context for key, or nil
	// if no value is associated with key. Successive calls to Value with
	// the same key returns the same result.
	//
	// Use context values only for request-scoped data that transits
	// processes and API boundaries, not for passing optional parameters to
	// functions.
	//
	// A key identifies a specific value in a Context. Functions that wish
	// to store values in Context typically allocate a key in a global
	// variable then use that key as the argument to context.WithValue and
	// Context.Value. A key can be any type that supports equality;
	// packages should define keys as an unexported type to avoid
	// collisions.
	//
	// Packages that define a Context key should provide type-safe accessors
	// for the values stored using that key:
	//
	// 	// Package user defines a User type that's stored in Contexts.
	// 	package user
	//
	// 	import "context"
	//
	// 	// User is the type of value stored in the Contexts.
	// 	type User struct {...}
	//
	// 	// key is an unexported type for keys defined in this package.
	// 	// This prevents collisions with keys defined in other packages.
	// 	type key int
	//
	// 	// userKey is the key for user.User values in Contexts. It is
	// 	// unexported; clients use user.NewContext and user.FromContext
	// 	// instead of using this key directly.
	// 	var userKey key
	//
	// 	// NewContext returns a new Context that carries value u.
	// 	func NewContext(ctx context.Context, u *User) context.Context {
	// 		return context.WithValue(ctx, userKey, u)
	// 	}
	//
	// 	// FromContext returns the User value stored in ctx, if any.
	// 	func FromContext(ctx context.Context) (*User, bool) {
	// 		u, ok := ctx.Value(userKey).(*User)
	// 		return u, ok
	// 	}
    // 获取key对应的value值
	Value(key interface{}) interface{}
}

// Canceled is the error returned by Context.Err when the context is canceled.
var Canceled = errors.New("context canceled")

// DeadlineExceeded is the error returned by Context.Err when the context's
// deadline passes.
var DeadlineExceeded error = deadlineExceededError{}

type deadlineExceededError struct{}

func (deadlineExceededError) Error() string   { return "context deadline exceeded" }
func (deadlineExceededError) Timeout() bool   { return true }
func (deadlineExceededError) Temporary() bool { return true }

// An emptyCtx is never canceled, has no values, and has no deadline. It is not
// struct{}, since vars of this type must have distinct addresses.
// 空的context
// 不会过期，没有截止时间，没有<k, v>
type emptyCtx int

func (*emptyCtx) Deadline() (deadline time.Time, ok bool) {
	return
}

func (*emptyCtx) Done() <-chan struct{} {
	return nil
}

func (*emptyCtx) Err() error {
	return nil
}

func (*emptyCtx) Value(key interface{}) interface{} {
	return nil
}

func (e *emptyCtx) String() string {
	switch e {
	case background:
		return "context.Background"
	case todo:
		return "context.TODO"
	}
	return "unknown empty Context"
}

var (
	background = new(emptyCtx)
	todo       = new(emptyCtx)
)

// Background returns a non-nil, empty Context. It is never canceled, has no
// values, and has no deadline. It is typically used by the main function,
// initialization, and tests, and as the top-level Context for incoming
// requests.
// 空Context的别名，用于构造所有context的根
func Background() Context {
	return background
}

// TODO returns a non-nil, empty Context. Code should use context.TODO when
// it's unclear which Context to use or it is not yet available (because the
// surrounding function has not yet been extended to accept a Context
// parameter).
// 空Context的别名，用于占位
// 比如你现在不知道要传什么context，就可以用TODO来占位
func TODO() Context {
	return todo
}

// A CancelFunc tells an operation to abandon its work.
// A CancelFunc does not wait for the work to stop.
// A CancelFunc may be called by multiple goroutines simultaneously.
// After the first call, subsequent calls to a CancelFunc do nothing.
// 定义取消操作
type CancelFunc func()

// WithCancel returns a copy of parent with a new Done channel. The returned
// context's Done channel is closed when the returned cancel function is called
// or when the parent context's Done channel is closed, whichever happens first.
//
// Canceling this context releases resources associated with it, so code should
// call cancel as soon as the operations running in this Context complete.
// 构建可取消的Context
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
    // 父Context不能为nil，这也为什么要对外提供Background的原因
	if parent == nil {
		panic("cannot create context from nil parent")
	}
    // 新建一个cancelCtx
	c := newCancelCtx(parent)
    // 将新建的cancelCtx向上挂靠到最近的可取消父Context
    // 对于WithCancel来说，这里有一个隐藏约定，就是所有的可取消的Context的Done()方法返回的channel都不会是nil，而所有不可取消的都是nil
	propagateCancel(parent, &c)
    // 返回Context和对应的cancel方法
	return &c, func() { c.cancel(true, Canceled) }
}

// newCancelCtx returns an initialized cancelCtx.
// 新建并返回cancelCtx
func newCancelCtx(parent Context) cancelCtx {
	return cancelCtx{Context: parent}
}

// goroutines counts the number of goroutines ever created; for testing.
// 测试用例使用，不用关心
var goroutines int32

// propagateCancel arranges for child to be canceled when parent is.
// 挂靠可取消父Context
// 该方法接受两个接口类型的参数，一个是Context，一个是canceler
// 因为取消Context的方式有多种，目前context包默认实现了两种
// canceler接口包含了不可导出的cancel方法，所以用户是无法自己实现canceler接口的
// 所以该方法接收canceler接口类型而不是具体的结构体比如cancelCtx
func propagateCancel(parent Context, child canceler) {
    // 获取父Context的取消通道
    // 因为Context以组合的方式来层层嵌套
    // 所以调用Done()方法也会逆序层层检查并调用
    // 当done == nil的时候，说明整个Context树都没有可取消的Context (上面说的约定)
 	done := parent.Done()
	if done == nil {
		return // parent is never canceled
	}

    // 这里判断parent是否已经取消，如果取消，则立刻调用child的cancel方法执行对应取消操作
	select {
	case <-done:
		// parent is already canceled
        // 注意这里传的第一个参数是false，代表不需要从parent的child集合中删除该child，理由很简单，因为还没挂靠上去
        // 具体可见cancel方法的实现
		child.cancel(false, parent.Err())
		return
	default:
	}
    // 是否找到可挂靠的cancelCtx
    // 这里需要做区分，如果是cancelCtx或者cancelCtx的包装类型且没有重写更改Done()和Value()方法和对应的动作，就可以通过child集合的方式进行挂靠
    // 否则就只能起个协程，以监听通道信号的方式进行挂靠
	if p, ok := parentCancelCtx(parent); ok {
        // 加锁
        // 这里加锁粒度要注意，因为考虑并发情况，判断p.err的时候就需要加锁，而且p.err设置只可能是在取消的时候且必须加锁，这里一旦加了锁，那么p.err就无法被设置，也就无法变更了
		p.mu.Lock()
		if p.err != nil {
			// parent has already been canceled
			child.cancel(false, p.err)
		} else {
			if p.children == nil {
                // 延迟初始化，同时对p.children的读写操作都要加锁
                // 这里又是struct{}的妙用，通过map实现了集合
				p.children = make(map[canceler]struct{})
			}
			p.children[child] = struct{}{}
		}
		p.mu.Unlock()
	} else {
        // 什么情况下认为有可取消Context但是没找到cancelCtx呢
        // 当用户自定义Done()或者Value()并且改变了原来的行为时，可能就会导致，具体看后面例子
		atomic.AddInt32(&goroutines, +1)  //测试用的，不用关心
		go func() {  // 开个协程，监听父Context和自己的取消信号
			select {
			case <-parent.Done():
				child.cancel(false, parent.Err())
			case <-child.Done():   //这里也要监听自己的，因为有可能child自动取消了，比如定时器Context
			}
		}()
	}
}

// &cancelCtxKey is the key that a cancelCtx returns itself for.
// 这是一个标识，用于复用Value()方法来找到cancelCtx
// 注意这是一个不可导出的变量
var cancelCtxKey int

// parentCancelCtx returns the underlying *cancelCtx for parent.
// It does this by looking up parent.Value(&cancelCtxKey) to find
// the innermost enclosing *cancelCtx and then checking whether
// parent.Done() matches that *cancelCtx. (If not, the *cancelCtx
// has been wrapped in a custom implementation providing a
// different done channel, in which case we should not bypass it.)
// 找到父cancelCtx
func parentCancelCtx(parent Context) (*cancelCtx, bool) {
    // 获得信号通道
	done := parent.Done()
    // 这里没有像propagateCancel方法使用select来判断是否关闭，也没有执行cancel操作，这个会向上抛给propagateCancel方法，通过case <-parent.Done():来操作cancel
    // 因为这里明确就是找到cancelCtx，而cancelCtx一旦取消了，done肯定就是closedchan
    // 而且这里又判断了一次done == nil是因为还有removeChild方法调用了该方法
	if done == closedchan || done == nil {
		return nil, false
	}
    // 只有cancelCtx实现的Value方法，才能通过Value(&cancelCtxKey)拿到自身
	p, ok := parent.Value(&cancelCtxKey).(*cancelCtx)
	if !ok {
		return nil, false
	}
    // 这里需要做进一步判断，因为通过value找到的Context的Done()方法可能被用户自定义覆盖了，这就不能按照cancelCtx来处理，因为其对应的cancel操作是会操作cancelCtx.done的，而这个done跟Done()方法返回的可能不是同一个，就会造成取消行为的歧义
    // 同时加了一把锁
	p.mu.Lock()
	ok = p.done == done
	p.mu.Unlock()
	if !ok {
		return nil, false
	}
	return p, true
}

// removeChild removes a context from its parent.
// 从parent的child集合中删除自己
func removeChild(parent Context, child canceler) {
    // 找到之前挂载的父Context
	p, ok := parentCancelCtx(parent)
	if !ok {
		return
	}
    // 修改行为，加锁
	p.mu.Lock()
    // 有可能在加锁之前，父Context执行了取消，p.children == nil
	if p.children != nil {
		delete(p.children, child)
	}
	p.mu.Unlock()
}

// A canceler is a context type that can be canceled directly. The
// implementations are *cancelCtx and *timerCtx.
// 取消接口
// 注意这里定义的cancel方法是不可导出的，不支持用户自定义
type canceler interface {
	cancel(removeFromParent bool, err error)
	Done() <-chan struct{}
}

// closedchan is a reusable closed channel.
// 可重用的已关闭的channel
var closedchan = make(chan struct{})

// init()方法，关闭closedchan
// 该方法在调用其他方法之前已执行
func init() {
	close(closedchan)
}

// A cancelCtx can be canceled. When canceled, it also cancels any children
// that implement canceler.
// 可取消Context
type cancelCtx struct {
	Context

	mu       sync.Mutex            // protects following fields
	done     chan struct{}         // created lazily, closed by first cancel call
	children map[canceler]struct{} // set to nil by the first cancel call
	err      error                 // set to non-nil by the first cancel call
}

func (c *cancelCtx) Value(key interface{}) interface{} {
    // 还记得吧，这个特殊的cancelCtxKey可以用来标记返回自身
	if key == &cancelCtxKey {
		return c
	}
	return c.Context.Value(key)
}

func (c *cancelCtx) Done() <-chan struct{} {
    // 常规加锁操作
	c.mu.Lock()
    // 这里会延迟初始化，主要是为了将done的初始化包装到cancelCtx的方法中，这样就算用户包装了cancelCtx，也能触发done的初始化
	if c.done == nil {
		c.done = make(chan struct{})
	}
	d := c.done
	c.mu.Unlock()
	return d
}

// 错误处理，不细说
func (c *cancelCtx) Err() error {
	c.mu.Lock()
	err := c.err
	c.mu.Unlock()
	return err
}

// 下面三个方法都是为了支持打印操作，不细说
type stringer interface {
	String() string
}

func contextName(c Context) string {
	if s, ok := c.(stringer); ok {
		return s.String()
	}
	return reflectlite.TypeOf(c).String()
}

func (c *cancelCtx) String() string {
	return contextName(c.Context) + ".WithCancel"
}

// cancel closes c.done, cancels each of c's children, and, if
// removeFromParent is true, removes c from its parent's children.
// cancelCtx的取消操作
func (c *cancelCtx) cancel(removeFromParent bool, err error) {
    // 必须要有取消信息
	if err == nil {
		panic("context: internal error: missing cancel error")
	}
	c.mu.Lock()
    // 已经取消过了
	if c.err != nil {
		c.mu.Unlock()
		return // already canceled
	}
	c.err = err
    // 还未初始化的done，就给一个已关闭的channel
	if c.done == nil {
		c.done = closedchan
	} else {
		close(c.done)
	}
    // 取消所有的子Context
	for child := range c.children {
		// NOTE: acquiring the child's lock while holding parent's lock.
		child.cancel(false, err)
	}
	c.children = nil
	c.mu.Unlock()

    // 是否从父Context的child集合中删除自己
	if removeFromParent {
		removeChild(c.Context, c)
	}
}

// WithDeadline returns a copy of the parent context with the deadline adjusted
// to be no later than d. If the parent's deadline is already earlier than d,
// WithDeadline(parent, d) is semantically equivalent to parent. The returned
// context's Done channel is closed when the deadline expires, when the returned
// cancel function is called, or when the parent context's Done channel is
// closed, whichever happens first.
//
// Canceling this context releases resources associated with it, so code should
// call cancel as soon as the operations running in this Context complete.
// 对cancelCtx的包装，支持截止时间
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
    // 如果父Context的截止时间比当前截止时间更早，那直接作为cancelCtx挂着就行了
	if cur, ok := parent.Deadline(); ok && cur.Before(d) {
		// The current deadline is already sooner than the new one.
		return WithCancel(parent)
	}
	c := &timerCtx{
		cancelCtx: newCancelCtx(parent),
		deadline:  d,
	}
    // 将c挂靠到可取消的父Context
	propagateCancel(parent, c)
	dur := time.Until(d)
    // 如果到了截止时间
	if dur <= 0 {
		c.cancel(true, DeadlineExceeded) // deadline has already passed
		return c, func() { c.cancel(false, Canceled) }
	}
     // 这里要加锁，因为一旦挂靠了，就可能被触发cancel操作
	c.mu.Lock()
	defer c.mu.Unlock()
     // 如果没有被触发取消
	if c.err == nil {
        // 启一个定时器，一旦到点就会执行func()，也就是cancel操作
		c.timer = time.AfterFunc(dur, func() {
			c.cancel(true, DeadlineExceeded)
		})
	}
	return c, func() { c.cancel(true, Canceled) }
}

// A timerCtx carries a timer and a deadline. It embeds a cancelCtx to
// implement Done and Err. It implements cancel by stopping its timer then
// delegating to cancelCtx.cancel.
type timerCtx struct {
	cancelCtx
	timer *time.Timer // Under cancelCtx.mu.

	deadline time.Time
}

// 获取截止时间
func (c *timerCtx) Deadline() (deadline time.Time, ok bool) {
	return c.deadline, true
}

func (c *timerCtx) String() string {
	return contextName(c.cancelCtx.Context) + ".WithDeadline(" +
		c.deadline.String() + " [" +
		time.Until(c.deadline).String() + "])"
}

// timerCtx的cancel操作
func (c *timerCtx) cancel(removeFromParent bool, err error) {
    // 注意这里是false，因为挂靠的是包装的timerCtx
	c.cancelCtx.cancel(false, err)
	if removeFromParent {
		// Remove this timerCtx from its parent cancelCtx's children.
		removeChild(c.cancelCtx.Context, c)
	}
	c.mu.Lock()
    // 停掉定时器
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.mu.Unlock()
}

// WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).
//
// Canceling this context releases resources associated with it, so code should
// call cancel as soon as the operations running in this Context complete:
//
// 	func slowOperationWithTimeout(ctx context.Context) (Result, error) {
// 		ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
// 		defer cancel()  // releases resources if slowOperation completes before timeout elapses
// 		return slowOperation(ctx)
// 	}
// WithDeadline的包装，支持超时时间段
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
	return WithDeadline(parent, time.Now().Add(timeout))
}

// WithValue returns a copy of parent in which the value associated with key is
// val.
//
// Use context Values only for request-scoped data that transits processes and
// APIs, not for passing optional parameters to functions.
//
// The provided key must be comparable and should not be of type
// string or any other built-in type to avoid collisions between
// packages using context. Users of WithValue should define their own
// types for keys. To avoid allocating when assigning to an
// interface{}, context keys often have concrete type
// struct{}. Alternatively, exported context key variables' static
// type should be a pointer or interface.
// 传递<k,v>的Context
func WithValue(parent Context, key, val interface{}) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if key == nil {
		panic("nil key")
	}
    // 注意必须是可比较的类型，slice、map和函数是不可以的
	if !reflectlite.TypeOf(key).Comparable() {
		panic("key is not comparable")
	}
	return &valueCtx{parent, key, val}
}

// A valueCtx carries a key-value pair. It implements Value for that key and
// delegates all other calls to the embedded Context.
type valueCtx struct {
	Context
	key, val interface{}
}

// stringify tries a bit to stringify v, without using fmt, since we don't
// want context depending on the unicode tables. This is only used by
// *valueCtx.String().
func stringify(v interface{}) string {
	switch s := v.(type) {
	case stringer:
		return s.String()
	case string:
		return s
	}
	return "<not Stringer>"
}

func (c *valueCtx) String() string {
	return contextName(c.Context) + ".WithValue(type " +
		reflectlite.TypeOf(c.key).String() +
		", val " + stringify(c.val) + ")"
}

// 获取<k,v>
func (c *valueCtx) Value(key interface{}) interface{} {
	if c.key == key {
		return c.val
	}
    // 这里会层层解套调用父Context的Value()方法来实现全遍历
	return c.Context.Value(key)
}

```

### 使用建议
以下是来自官方的使用Context的建议，比较好读，不翻译了
 - Contexts inside a struct type; instead, pass a Context explicitly to each function that needs it. The Context should be the first parameter, typically named ctx.
 - Do not pass a nil Context, even if a function permits it. Pass context.TODO if you are unsure about which Context to use.
 - Use context Values only for request-scoped data that transits processes and APIs, not for passing optional parameters to functions.
 - The same Context may be passed to functions running in different goroutines; Contexts are safe for simultaneous use by multiple goroutines.

### 举个栗子
#### WithValue
```go
func main() {

	ctx := context.WithValue(context.Background(), 1, 1)
	ctx = withName(ctx)
	WithValueTest(ctx)
}

func withName(ctx context.Context) context.Context {
	return context.WithValue(ctx, "name", "joker")
}

func WithValueTest(ctx context.Context) {
	fmt.Println(ctx.Value(1).(int))  // 1
	fmt.Println(ctx.Value("name").(string)) // joker
	v, ok := ctx.Value("no-set").(int)
	fmt.Println(v, ok)  // 0 false
}
```
注意，这只是个用法示例，实际使用中Context传递的应该是作用于整个请求的数据，比如request_id，token之类的，自定义的数据尽量通过参数传递，否则当Context嵌套层数一多，你自己可能都搞不清楚传了哪些，哪些节点能获取到哪些数据

#### WithCancel
```go
func main() {

	ctx, cancel := context.WithCancel(context.Background())
	go handler(ctx)
	time.Sleep(time.Second * 3)

	cancel()
	time.Sleep(time.Second * 2)
}

func handler(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			fmt.Println("handler canceled")
			return
		default:
			fmt.Println("handler running")
			time.Sleep(time.Second)
		}
	}
}

// output
handler running
handler running
handler running
handler running
handler canceled
```

#### WithTimeout
```go
func main() {

	ctx, _ := context.WithTimeout(context.Background(), time.Second * 2)
	go handler(ctx)

	time.Sleep(time.Second * 4)
}

func handler(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			fmt.Println("handler canceled")
			return
		default:
			fmt.Println("handler running")
			time.Sleep(time.Second)
		}
	}
}

// output
handler running
handler running
handler canceled
```

### 总结
`context`解决了并发控制的问题，但是设计上面并不够优雅，需要所有涉及到的方法/函数层层传递Context类型参数，而且对于Value()方法的实现，是递归的链式处理，性能不是很好，且使用的范围有限，对初学者很容易误用滥用导致后期维护困难