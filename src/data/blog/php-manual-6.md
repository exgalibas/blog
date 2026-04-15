---
title: "PHP手册--抽象类"
author: "Joker"
pubDatetime: 2016-05-17T12:05:45+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于抽象类有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---类与对象---static
[参考详情](https://secure.php.net/manual/zh/language.oop5.static.php#96402)

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---类与对象---抽象类
[参考详情](https://secure.php.net/manual/zh/language.oop5.abstract.php)

#### 评论
1. 尽管不能使用new来创建抽象类的实例,但是依然可以使用::来调用抽象类中的静态方法
```php
abstract class Foo
{
    static function bar()
    {
        echo "test\n";
    }
}
Foo::bar(); // output test
```
2. 你可以像这样使用abstract
```php
abstract class A{
    public function show(){
        echo 'A';
    }
}
class B extends A{
    public function hello(){
        echo 'B';
        parent::show();
    }
}
$obj = new B;
$obj->hello(); // BA
```
可以看到，抽象类不一定包含有抽象方法，抽象类可继承,并且可以在子类中使用parent关键字

3. 一段代码
```php
abstract class Basic {
    public static function doWork() {
        return static::work();
    }

    abstract public static function work();
}
class Keeks extends Basic {
    public static function work() {
        return 'Keeks';
    }
}

echo Keeks::doWork();   //output Keeks
```
可以声明静态抽象方法，抽象类中非抽象方法里调用静态抽象方法,务必不能使用self,请使用static代替

4. 实际上,抽象类不一定是基类,它也可以继承别的类或者抽象类
```php
class Foo {
    public function sneeze() { echo 'achoooo'; }
}
abstract class Bar extends Foo {
    public abstract function hiccup();
}
class Baz extends Bar {
    public function hiccup() { echo 'hiccup!'; }
}

$baz = new Baz();
$baz->sneeze();  //achoooo
$baz->hiccup();  //hiccup!
```
5. 抽象类可以继承抽象类,同时会继承抽象方法,所以注意避免重复定义方法,以及实现类的实现个数