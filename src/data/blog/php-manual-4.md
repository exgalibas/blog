---
title: "PHP手册--类常量"
author: "Joker"
pubDatetime: 2016-05-16T15:02:03+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于类常量有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---类与对象---类常量
[参考详情](https://secure.php.net/manual/zh/language.oop5.constants.php)

#### 评论
1. constant常量的访问限制总是public,你不能声明为private或者protected
2. 你可以在抽象类中定义constant,并且在继承它的子类中声明相同的constant,通过不同的类名进行区分调用
```php
abstract class dbObject
{
    const TABLE_NAME='undefined';

    public static function GetAll()
    {
        $c = get_called_class();
        return "SELECT * FROM `".$c::TABLE_NAME."`";
    }
}

class dbPerson extends dbObject
{
    const TABLE_NAME='persons';
}

class dbAdmin extends dbPerson
{
    const TABLE_NAME='admins';
}

echo dbPerson::GetAll()."<br>";//output: "SELECT * FROM `persons`"
echo dbAdmin::GetAll()."<br>";//output: "SELECT * FROM `admins`"
```
3. 你可以使用延迟静态绑定来区分调用constant
```php
class A {
    const MY_CONST = false;
    public function my_const_self() {
        return self::MY_CONST;
    }
    public function my_const_static() {
        return static::MY_CONST;
    }
}

class B extends A {
    const MY_CONST = true;
}

$b = new B();
echo $b->my_const_self() ? 'yes' : 'no'; // output: no
echo $b->my_const_static() ? 'yes' : 'no'; // output: yes
```
4. 中括号可以用来提取字符串中的某个字符,但是你不可以像这样$constant[num/key]来使用
```php
class SomeClass
{
    const SOME_STRING = '0123456790';
    public static function ATest()
    {
        return self::SOME_STRING[0];   //error
  }
}
```
5. 你也可以在constant函数中得到constant变量,这样你可以使用变量来表示类名和常量名
```php
function get_class_const($class, $const){
    return constant("$class::$const");
}

class Foo{
    const BAR = 'foobar';
}

$class = 'Foo';
echo get_class_const($class, 'BAR'); // 'foobar'
```
如果你不使用constant()函数,而直接return $class::$const将会出错,或者你这样return $class::$$const或者return $class::{$const}都会出错