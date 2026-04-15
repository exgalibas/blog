---
title: "PHP生成器和yield"
author: "Joker"
pubDatetime: 2016-05-20T21:01:05+08:00
draft: false
tags:
  - "PHP"
description: "PHP生成器和yield的说明和使用"
---

#### 简介
生成器和yield结合可以实现php的协程

#### 前置知识
如果对生成器和yield不了解，可以先看看下面两个博客
[鸟哥](http://www.laruence.com/2015/05/28/3038.html)
[路人甲](https://laravel-china.org/articles/1430/single-php-generator-complete-knowledge-generator-implementation-process)

#### 一些补充
看鸟哥的介绍中有这么一段代码
```php
function gen() {
    $ret = (yield 'yield1');
    var_dump($ret);
    $ret = (yield 'yield2');
    var_dump($ret);
}
 
$gen = gen();
var_dump($gen->current());    // string(6) "yield1"
var_dump($gen->send('ret1')); // string(4) "ret1"   (the first var_dump in gen)
                              // string(6) "yield2" (the var_dump of the ->send() return value)
var_dump($gen->send('ret2')); // string(4) "ret2"   (again from within gen)
                              // NULL               (the return value of ->send())
```

yield的功能是让程序自己交出控制权，并停留在当前的执行位置，yield可以看成是return，返回给生成器数据，同时也可以接收生成器传递过来的数据并替换当前yield表达式，可以看成是双向管道
下面对以上代码作一些解释：
1. ```$gen->current()```获取当前调用的yield返回值并停留在此处
2. ```$gen->send('ret1')```将```ret1```传递并替换当前的yield表达式，并隐式调用```$gen->next()```,使得程序继续执行，同时返回下一个yield返回值。此时第一个yield表达式被替换为```ret1```，所以```$ret = ret1```，第二个var_dump会触发```gen()```中的第一个```var_dump($ret)```，所以先输出```ret1```再输出```$gen->send()```的返回值(即下一个yield的返回值)```yield2```。
3. 同理```$gen->send('ret2')```也会赋值并触发```gen()```中的第二个```var_dump($ret)```，同时返回下一个yield值，然而程序到此结束了，所以返回null

#### 生成器方法
 -  ```current()``` 返回当前产生的值，即是yield返回给生成器的值
 - ```key()``` 返回当前产生的键，当yield返回的不是键值对的时候，默认使用索引键，如下:
```php
function gen()
{
    yield "a";
    yield "b";
    yield "name" => "joker"; // 返回键值对
}

$gen = gen();
var_dump($gen->key()); // 0
$gen->next();
var_dump($gen->key()); // 1
$gen->next();
var_dump($gen->key()); // name
```
 - ```next()``` 生成器继续执行，通过调用生成器的```next()```来继续执行被yield阻塞的后面的代码，没有返回值
 - ```rewind()``` 重置迭代器，如果迭代已经开始，调用该方法会抛出一个异常，每次调用生成器函数生成生成器的时候会自动调用一次```rewind()```，没有返回值
 - ```valid()``` 检查迭代器是否被关闭，即迭代是否已经结束，返回true/false
 - ```send()``` 向生成器中传入一个值，并将这个值传递给当前yield，替换整个yield表达式，然后继续执行生成器(无须显式调用```next()```触发程序继续执行)，返回下一个yield的返回值