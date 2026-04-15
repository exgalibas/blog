---
title: "Golang源码系列--ioutil"
author: "Joker"
pubDatetime: 2019-03-26T15:11:12+08:00
draft: false
tags:
  - "Golang源码"
description: "Golang ioutil的实现源码解析"
---

### 概述
ioutil包实现了一些I/O使用函数

### ReadAll
#### 原型
```go
func ReadAll(r io.Reader) ([]byte, error) {
	return readAll(r, bytes.MinRead)
}
```
对`r`进行读取，直到发生错误或者遇到`EOF`，所以一次成功的读取将返回`nil`而不是`EOF`作为`err`的值
#### 示例
```go
package main

import (
	"strings"
	"io/ioutil"
	"log"
	"fmt"
)

func main() {
	r := strings.NewReader("joker")
	b, err := ioutil.ReadAll(r)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(b))
}

// output
joker
```

#### 源码
`ReadAll`方法实际调用的是ioutil包的内部方法`readAll`
```go
func readAll(r io.Reader, capacity int64) (b []byte, err error) {
	var buf bytes.Buffer
	// 如果buffer缓冲区溢出，会返回bytes.ErrTooLarge类型的error
	// 否则直接panic中断
	defer func() {
		e := recover()
		if e == nil {
			return
		}
		if panicErr, ok := e.(error); ok && panicErr == bytes.ErrTooLarge {
			err = panicErr
		} else {
			panic(e)
		}
	}()
        // 这里判断int64类型的capacity数值是否在int类型可表示的范围内，如果在的话，一次性通过
        // buffer.Grow进行内存扩从，避免后期读取的时候频繁扩展，降低性能消耗
	if int64(int(capacity)) == capacity {
		buf.Grow(int(capacity))
	}
	_, err = buf.ReadFrom(r)
	return buf.Bytes(), err
}
```

### ReadDir
#### 原型
```go
func ReadDir(dirname string) ([]os.FileInfo, error)
```
读取`dirname`指定的目录，并返回一个根据文件名进行排序的目录节点列表

#### 示例
```go
package main

import (
	"io/ioutil"
	"log"
	"fmt"
)

func main() {
	files, err := ioutil.ReadDir(".")
	if err != nil {
		log.Fatal(err)
	}

	for _, file := range files {
		fmt.Println(file.Name())
	}
}
```

#### 源码
```go
func ReadDir(dirname string) ([]os.FileInfo, error) {
	f, err := os.Open(dirname)
	if err != nil {
		return nil, err
	}
        // -1 读取所有文件文件信息
	list, err := f.Readdir(-1)
        // 这里不使用defer，手动进行Close释放
        // 避免文件数目过多，后面的排序时间相对略长导致资源占用
	f.Close()
	if err != nil {
		return nil, err
	}
        // 根据文件名排序
	sort.Slice(list, func(i, j int) bool { return list[i].Name() < list[j].Name() })
	return list, nil
}
```

### ReadFile
#### 原型
```go
func ReadFile(filename string) ([]byte, error)
```
读取`filename`文件并返回文件中的内容，由于是读取整个文件，所以返回的err不会是EOF

#### 示例
```go
package main

import (
	"io/ioutil"
	"log"
	"fmt"
)

func main() {
	file, err := ioutil.ReadFile("glide.lock")
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(string(file))
}
```

#### 源码
```go
func ReadFile(filename string) ([]byte, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	
    // 文件读取缓冲区默认初始化大小
	var n int64 = bytes.MinRead

	if fi, err := f.Stat(); err == nil {
		// 根据文件实际大小初始化缓冲区大小，避免运行时重复内存分配
                // 这里可以看到ReadFile和ReadAll的区别，ReadAll会使用默认的capacity，读取大文件ReadFile比ReadAll性能更好
		if size := fi.Size() + bytes.MinRead; size > n {
			n = size
		}
	}
	return readAll(f, n)
}
```

### WriteFile
#### 原型
```go
func WriteFile(filename string, data []byte, perm os.FileMode) error
```
将给定的数据`data`写入到`filename`文件中，如果`filename`不存在，使用给定的权限perm去创建，如果`filename`已经存在，则在写入之前清空文件中已有的内容

#### 示例
```go
package main

import (
	"io/ioutil"
	"os"
	"log"
	"fmt"
)

func main() {
	err := ioutil.WriteFile("test", []byte("joker"), os.ModePerm)
	if err != nil {
		log.Fatal(err)
	}

	file, err := ioutil.ReadFile("test")
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(string(file))
}
```

#### 源码
```go
func WriteFile(filename string, data []byte, perm os.FileMode) error {
	f, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	n, err := f.Write(data)
        // data是否全部写入成功
	if err == nil && n < len(data) {
		err = io.ErrShortWrite
	}
        // 这里需要关注下写入Close()有可能报错，不能跟读取一样放到defer里面
        // 因为Close的错误有可能导致写入的内容没有落地到硬盘
        // 具体原因可以参见这里 https://www.joeshaw.org/dont-defer-close-on-writable-files/
	if err1 := f.Close(); err == nil {
		err = err1
	}
	return err
}
```

### 总结
不得不说，go包的源码考虑十分周到，舒适啊~