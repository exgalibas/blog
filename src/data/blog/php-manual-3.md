---
title: "PHP手册--匿名函数"
author: "Joker"
pubDatetime: 2016-05-16T13:10:02+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于匿名函数有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---函数---匿名函数
[参考详情](https://secure.php.net/manual/zh/functions.anonymous.php)

#### 评论
1. 当在你的匿名函数中导入变量时,只是进行简单的复制操作,而且在匿名函数定义的时候就进行了该操作,所以之后对该变量的任何修改都不会影响匿名函数,如果你需要根据变量的变化实时变化,你需要使用引用&
```php
$result = 0;

$one = function()
{ var_dump($result); };

$two = function() use ($result)
{ var_dump($result); };

$three = function() use (&$result)
{ var_dump($result); };

$result++;
$one();    // outputs NULL: $result is not in scope
$two();    // outputs int(0): $result was copied
$three();    // outputs int(1)
```
2. 一段代码
```php
/*
(string) $name 是你想添加到类中的方法的名字.
用法 : $Foo->add(function(){},$name);
这样将会向实例中添加public方法;
*/
class Foo
{
    public function add($func,$name)
    {
        $this->{$name} = $func;
    }
    public function __call($func,$arguments){
        call_user_func_array($this->{$func}, $arguments);
    }
}
$Foo = new Foo();
$Foo->add(function(){
    echo "Hello World";
},"helloWorldFunction");
$Foo->add(function($parameterone){
    echo $parameterone;
},"exampleFunction");
$Foo->helloWorldFunction(); /*Output : Hello World*/
$Foo->exampleFunction("Hello PHP"); /*Output : Hello PHP*/
```

3. 当你使用匿名函数进行自我递归时, 在use()里面需要用引用操作符&
```php
$recursive = function () use (&$recursive){
    // The function is now available as $recursive
    static $a = 0;
    @print "$a\n";
    if($a++ == 100){
        echo 'over';
        return;
    }
    $recursive();
};
$recursive();
```
注意,这里会产生一个fatal error:maximum function nesting level of '100' reached,这不是程序的问题,是php.ini里面有一个选项xdebug.max_nesting_level默认设置为100,所以最高能嵌套层数必须小于100,所以如果你需要嵌套的层数大于这个数,请自行修改php.ini.同时值得一提的是,匿名函数中也可以像普通自定义函数那样使用static变量

4. 如果你将类实例的变量关联到匿名函数,那么当你使用该变量访问匿名函数时,结果也许会令你失望
```php
$obj = new StdClass();
$obj->func = function(){
    echo "hello";
};
//$obj->func(); // 会出错,因为php会去$obj的类中寻找func()方法,结果却是undefined method
// you have to do this instead:
$func = $obj->func;
$func();

// or:
call_user_func($obj->func);

// however, you might wanna check this out:
$array['func'] = function(){
    echo "hello";
};

$array['func'](); // it works! i discovered that just recently ;)
```
5. 一段有意思的代码
```php
    $fib = function($n) use(&$fib) {
        if($n == 0 || $n == 1) return 1;
        return $fib($n - 1) + $fib($n - 2);
    };

   echo $fib(2) . "\n"; // 2
   $lie = $fib;
   $fib = function(){die('error');};//rewrite $fib variable 
   echo $lie(5); // error   because $fib is referenced by closure
```
注意到$fib中使用到了use(&$fib),所以当$fib改了之后会继续影响$lie的输出,如果一不小心就掉进去了,认为$lie=$fib是引用,其实不然,可以添加一层外壳进行隔绝保护
```php
$fib = call_user_func(function(){
   
    $fib = function($n) use(&$fib) {
        if($n == 0 || $n == 1) return 1;
        return $fib($n - 1) + $fib($n - 2);
    };
    return $fib;
});

echo $fib(2) . "\n";//2
$ok = $fib;

$fib = function(){die('error')};//rewrite $fib variable but don't referenced $fib used by closure
echo $ok(5);//result ok 
```
使用call_user_func之后,里面的$fib与外面的$fib的作用域范围就不一样了,对外部的$fib的修改将不会影响内部对$fib的引用,也不会对$lie造成任何影响,测试这段代码的时候我没有注意到&$fib导致以为匿名函数的赋值是引用行为,结果发现修改$lie后并不会对$fib造成影响,当即就崩了,还专门跑去看php内核匿名的实现,发现其是通过closure类和__invoke来实现的,并不会造成这样的结果,然后一字一字排查,才发现这个愚蠢的疏忽

6. 你可以在类内使用匿名函数对private或者protected变量进行读写,在匿名函数中可以直接使用$this,不需要使用use($this)将$this传入进去,这样反而会发生error
```php
class Scope
{
    protected $property = 'default';
    // or even
    // private $property = 'default';

    public function run()
    {
        $func = function() {
            $this->property = 'changed';
        };
        $func();
        var_dump($this->property);
    }
}

$scope = new Scope();
$scope->run(); // 输出 changed
```