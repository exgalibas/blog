---
title: "PHP手册--static"
author: "Joker"
pubDatetime: 2016-05-17T10:30:32+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于static有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---类与对象---static
[参考详情](https://secure.php.net/manual/zh/language.oop5.static.php#96402)

#### 评论
1. 在子类中覆盖父类static变量,并调用父类方法对子类的static进行更改,结果不会如预期
```php
class A {
    protected static $a;

    public static function init($value) { self::$a = $value; }
    public static function getA() { return self::$a; }
}

class B extends A {
    protected static $a; // redefine $a for own use

    // inherit the init() method
    public static function getA() { return self::$a; }
}

B::init('lala');
echo 'A::$a = '.A::getA().'; B::$a = '.B::getA();
```
输出`A::$a=lala; B::$a=`，使用B::init()却是对A::static的更改,这里A::init()需要将self改成static进行延迟绑定才能达到预期的效果

2. static变量可以在子类间共享
```php
class MyParent {
    protected static $variable;
}
class Child1 extends MyParent {
    function set() {
        self::$variable = 2;
    }
}
class Child2 extends MyParent {
    function show() {
        echo(self::$variable);
    }
}

$c1 = new Child1();
$c1->set();
$c2 = new Child2();
$c2->show(); // prints 2
```
3. 如果你尝试像如下写代码,将会发生fatal error
```php
class Base
{
    static function Foo ()
    {
        self::Bar();
    }
}

class Derived extends Base
{
    function Bar ()
    {
        echo "Derived::Bar()";
    }
}
Derived::Foo(); // we want this to print "Derived::Bar()",but sorry,fatal error!
```
php中的`self::`只能指向该代码所在类里的属性或者方法,而不是指向实际调用`self`的类.不能使用`__CLASS__`代替`self`,因为它不能出现再::的前面,而且它同`self`一样不能指向实际调用它的类,如果你必须要这样坐,你应该使用下面
```php
class Base
{
    static function Foo ($class = __CLASS__)
    {
        //$class::Bar();
        call_user_func(array($class,'Bar'));
    }
}

class Derived extends Base
{
    function Bar ()
    {
        echo "Derived::Bar()";
    }
}

Derived::Foo('Derived');  //output Derived::Bar()
```
4. 之前讨论过self指向所在代码类的问题,$this关键字与self不同,它指向调用它的类实例
```php
class a {
    public function get () {
        echo $this->connect();
    }
}
class b extends a {
    private static $a;
    public function connect() {
        return self::$a = 'b';
    }
}
class c extends a {
    private static $a;
    public function connect() {
        return self::$a = 'c';
    }
}
$b = new b ();
$c = new c ();

$b->get(); //output b
$c->get();  //output c
```
`class a` 的`function get()`会根据调用类的不同而解释不同的`$this`

5. 某个类被继承,那么它的static属性也将被"引用继承"(自定义的说法,方便理解,下同)到子类,即子类和父类共同持有该static,他们的任一对static的改变都会互相影响
```php
class a
{
  public static $s;
  public function get()
  {
    return self::$s;
  }
}

class b extends a { }
class c extends b { }
a::$s = 'a';
$c = new c();
echo $c->get(); // a
```
但是相同的场景,如果是static或非static方法被"复制继承",那么该方法内的static或非static变量在不同的类中将相互独立
```php
class a
{
  public final function v($vs = null)
  {
    static $s = null;
    if(!is_null($vs))
    $s = $vs;
    return $s;
  }
}

class b extends a { }
class c extends b { }
$a = new a();
$a->v('a');
$aa = new a();
$aa->v('last a');
$c = new c();
$c->v('c');
echo $a->v().' - '.$c->v(); // last a - c
```
可以看到此时的类c和类a对function v的操作相互独立,这里function v使用final关键字,可以防止子类对v的覆盖

6. 另外一种父类访问子类static属性的方
```php
class A {
    public static $my_vars = "I'm in A";
    static function find($class) {
        $vars = get_class_vars($class) ;
        echo $vars['my_vars'] ;
    }
}
class B extends A {
    public static $my_vars = "I'm in B";
}

A::find("B"); // Result : "I'm in B"
```
其实,如果将类`B`传递过去,就可以直接使用`$class::$my_vars`来进行调用了,这里仅做为一个不同的方法