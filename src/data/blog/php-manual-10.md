---
title: "PHP手册--Callback"
author: "Joker"
pubDatetime: 2016-05-20T14:33:19+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于Callback有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录：语言参考---类型---Callback回调类型
[参考详情](https://secure.php.net/manual/zh/language.types.callable.php)

#### 评论
1. 可以使用`self::methodName`作为一个回调函数，但是这样做是很危险的
```php
class Foo {
    public static function doAwesomeThings() {
        FunctionCaller::callIt('self::someAwesomeMethod');
    }

    public static function someAwesomeMethod() {
        // fantastic code goes here.
    }
}

class FunctionCaller {
    public static function callIt(callable $func) {
        call_user_func($func);
    }
}

Foo::doAwesomeThings();
}
```
运行出错:class 'FunctionCaller' does not have a method 'someAwesomeMethod'.因为FunctionCaller并不知道self对应着Foo

基于此,你应该始终使用全类名进行调用,如下:
```php
FunctionCaller::callIt('Foo::someAwesomeMethod');
```
2. 当你指明类的方法以数组的形式回调时(例如.`array($this,'myFunc')`)，回调的方法可以是私有的，但此种情况只适用于类内调用，如果类外调用私有方法将会报错
```php
class mc {
   public function go(array $arr) {
       array_walk($arr, array($this, "walkIt"));
   }

   private function walkIt($val) {
       echo $val . "<br />";
   }

    public function export() {
        return array($this, 'walkIt');
    }
}

$data = array(1,2,3,4);

$m = new mc;
$m->go($data); // valid

array_walk($data, $m->export()); // 将会产生警告
```
输出:1<br />2<br />3<br />4<br />
warning:array_walk() expects parameter 2 to be a valid callback, cannot access private method mc::walkIt() in /in/tfh7f on line 22.

3. 你可以使用`$this`来指定一个回调函数
```php
class MyClass {
    public $property = 'Hello World!';
    public function MyMethod()
    {
        call_user_func(array($this, 'myCallbackMethod'));
    }

    public function MyCallbackMethod()
    {
        echo $this->property;
    }
}
```
4. 可以像回调一个方法那样回调一个实现了`__invoke()`魔术方法的对象，`__invode()`方法会在你尝试以调用函数的形式调用对象时被自动调用
```php
class CallableClass 
{
    function __invoke($x) {
        var_dump($x);
    }
}
$obj = new CallableClass;
call_user_func($obj, 5);   //以函数的形式进行调用,会调用__invoke(),输出int(5)
var_dump(is_callable($obj));   //是callable类型的
```