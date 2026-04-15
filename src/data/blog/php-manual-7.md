---
title: "PHP手册--Trait"
author: "Joker"
pubDatetime: 2016-05-17T14:15:00+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于Trait有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---类与对象---Trait
[参考详情](https://secure.php.net/manual/zh/language.oop5.traits.php)

#### 评论
1. 与继承不同,如果trait中包含有静态属性,那么每一个use trait的类将是相互独立的
```php
// use parent class
class TestClass {
    public static $_bar;
}
class Foo1 extends TestClass { }
class Foo2 extends TestClass { }
Foo1::$_bar = 'Hello';
Foo2::$_bar = 'World';
echo Foo1::$_bar . ' ' . Foo2::$_bar; // Prints: World World

// use trait
trait TestTrait {
    public static $_bar;
}
class Foo1 {
    use TestTrait;
}
class Foo2 {
    use TestTrait;
}
Foo1::$_bar = 'Hello';
Foo2::$_bar = 'World';
echo Foo1::$_bar . ' ' . Foo2::$_bar; // Prints: Hello World
```
2. `__class__`将返回trait代码所在类的类名,而非调用trait内部方法的类的类名
```php
trait TestTrait {
    public function testMethod() {
        echo "Class: " . __CLASS__ . PHP_EOL;
        echo "Trait: " . __TRAIT__ . PHP_EOL;
    }
}

class BaseClass {
    use TestTrait;
}

class TestClass extends BaseClass {}

$t = new TestClass();
$t->testMethod();

//Class: BaseClass
//Trait: TestTrait
```
3. final关键字在trait中不管用,与继承和抽象是不同的
```php
trait Foo {
    final public function hello($s) { print "$s, hello!"; }
}
class Bar {
    use Foo;
    // Overwrite, no error
    final public function hello($s) { print "hello, $s!"; }
}

abstract class Foo {
    final public function hello($s) { print "$s, hello!"; }
}
class Bar extends Foo {
    // Fatal error: Cannot override final method Foo::hello() in ..
    final public function hello($s) { print "hello, $s!";
 }
```
要实现final效果,你可以通过多重继承来实现
```php
trait Foo {
    final public function hello($s) { print "$s, hello!"; }
}
class Bar {
    use Foo;
    // Overwrite, no error
    //public function hello($s) { print "hello, $s!"; }
}
class a extends Bar{
    public function hello($s) { print "hello, $s!"; }
}
a::hello("he"); // Fatal error:Cannot override final method Bar::hello()
```
4. 当trait中定义了static 方法的时候,可以使用`::`直接调用
```php
trait Foo {
    public static function bar() {
        return 'baz';
    }
}
echo Foo::bar(); \\ output baz
```
同时这种方式也适用于trait中定义static 变量

5. 当trait名与类名相同时,将产生fatal error
```php
trait samara{}
class samara{
    use samara; // fatal error redeclare class samara
}
```