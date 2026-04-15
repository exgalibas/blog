---
title: "PHP手册--可变变量"
author: "Joker"
pubDatetime: 2016-05-15T14:50:02+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于可变变量有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---变量---可变变量
[参考详情](https://secure.php.net/manual/zh/language.variables.variable.php)

#### 评论
1. php允许你添加很多的$符号来使用可变变量
```php
$Bar = "a";
$Foo = "Bar";
$World = "Foo";
$Hello = "World";
$a = "Hello";

echo $a; //Returns Hello
echo $$a; //Returns World
echo $$$a; //Returns Foo
echo $$$$a; //Returns Bar
echo $$$$$a; //Returns a

echo $$$$$$a; //Returns Hello
echo $$$$$$$a; //Returns World
```
2. php可以通过可变变量调用类方法
```php
class Foo {
    public function hello() {
        echo 'Hello world!';
    }
}
$my_foo = 'Foo';
$a = new $my_foo();
$a->hello(); //prints 'Hello world!'
```
同时也可以通过可变变量调用类静态方法
```php
class Foo {
    public static function hello() {
        echo 'Hello world!';
    }
}
$my_foo = 'Foo';
$my_foo::hello(); //prints 'Hello world!'
```
3. 定界符{}对于使用可变变量是很重要的
```php
$tab = array("one", "two", "three") ;
$a = "tab" ;
$$a[] ="four" ; // <==== fatal error
print_r($tab) ;
```
会报错,这并不是一个bug,而是书写的错误,对于$$a[]我们需要使用定界符,写程${$a}[]即可正确执行

4. 你不可以像`$variable-name= 'name'` 这样命名一个变量,但是你可以通过可变变量做到
```php
$a = 'variable-name';
$$a = 'hello';
echo $$a; //output hello
```
5. 可能有些情景,你想要使用可变变量来动态引用超全局变量,但是是否能成功有时可能会因为当时的访问范围的变化而变化
```php
$_POST['asdf'] = 'something';
function test() {
    // NULL -- not what initially expected
    $string = '_POST';
    var_dump(${$string});

    // Works as expected
    var_dump(${'_POST'});

    // Works as expected
    global ${$string};
    var_dump(${$string});

}
// Works as expected
$string = '_POST';
var_dump(${$string});
test();
```
除了test方法中的第一个引用失败,其他均成功