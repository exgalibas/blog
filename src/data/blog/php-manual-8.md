---
title: "PHP手册--clone"
author: "Joker"
pubDatetime: 2016-05-18T15:05:05+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于clone有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---类与对象---clone
[参考详情](https://secure.php.net/manual/zh/language.oop5.cloning.php)

#### 评论
1. 当类内部调用__clone对属性进行同类实例clone时,会造成循环clone,但是实际代码不会这样任由你胡作非为,但是经过本人测试,会造成clone循环调用
```php
class Foo
{
    var $that;
    function __clone()
    {
        $this->that = clone $this->that;
    }
}
$a = new Foo;
$b = new Foo;
$a->that = $b;
$b->that = $a;
$c = clone $a;
echo 'What happened?';
var_dump($c);
```
输出 Fatal error:  Maximum function nesting level of '100' reached, aborting!因为php.ini里面有设置递归层数,所以当循环clone到这个层数的时候,就会error,如果允许无限循环,那么它会吃空内存,知道没有资源可用为止

2. clone只适用于object,如果你这样写;
```php
$a = 'a';
$b = clone $a;
```
将会报错,Alexey提出一种办法,不用考虑clone的对象是否是object
```php
function clone_($some)
{
   return (is_object($some)) ? clone $some : $some;
}
```
这样当$some是object的时候,执行clone,如果不是,执行普通复制操作

3. clone对象的时候,对类属性中非object属性只是执行简单复制,如果要将clone之后的实例属性与本体属性相关联,可以使用&
```php
class A
{
    public $name ;
    public function __construct()
    {
        $this->name = & $this->name;
    }
}
$a = new A;
$a->name = "George";
$b = clone $a;
$b->name = "Somebody else";
var_dump($a);
var_dump($b);

/*
this will output:
object(A)#1 (1) {
  ["name"]=>
  &string(13) "Somebody else"
}
object(A)#2 (1) {
  ["name"]=>
  &string(13) "Somebody else"
}
*/

// 以上仅仅适用于php7之前的，php7的输出如下
/*
object(A)#1 (1) {
  ["name"]=>
  string(6) "George"
}
object(A)#2 (1) {
  ["name"]=>
  string(13) "Somebody else"
}
*/
```
4. 使用clone复制对象的时候,并等同于新建了一个实例,而是开辟一块内存空间给clone过来的对象,所以不会调用__construct方法
```php
class Foo
{
    function __construct()
    {
        echo 'instance';
    }
}

$a = new Foo();
$b = clone $a;
```
只输出一个instance

5. 如果类中包含object属性,或者array属性,并且array中可能有object,那么使用下面的代码可以对其进行深clone
```php
function __clone() {
    foreach($this as $key => $val) {
        if(is_object($val)||(is_array($val))){
            $this->{$key} = unserialize(serialize($val));
        }
    }
}
```