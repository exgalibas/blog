---
title: "PHP手册--变量范围"
author: "Joker"
pubDatetime: 2016-05-15T12:59:04+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于变量范围有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---变量---变量范围
[参考详情](https://secure.php.net/manual/zh/language.variables.scope.php)

#### 评论部分
1. 提出一些有趣的代码，在类函数里面使用static变量
```php
class sample_class
{
  public function func_having_static_var($x= NULL)
  {
    static $var = 0;
    if ($x === NULL)
    { return $var; }
    $var = $x;
  }
}

$a = new sample_class();
$b = new sample_class();
echo $a->func_having_static_var()."\n";
echo $b->func_having_static_var()."\n";
// this will output (as expected):
//  0
//  0

$a->func_having_static_var(3);
echo $a->func_having_static_var()."\n";
echo $b->func_having_static_var()."\n";
// this will output:
//  3
//  3
// maybe you expected:
//  3
//  0
?>

本来我们期望的可能是输出3.0,因为两个不同的实例,调用public非static方法,应该是互不干扰的.但是结果却告诉我们并非如此,方法中的static变量会作用于整个类方法以及所有的类实例,而不仅仅针对某一个实例.如果你想得到期望的输出,你应该放弃使用方法内static变量,像这样:

<?php
class sample_class
{ protected $var = 0;    //使用类内非static变量代替
  function func($x= NULL)
  { $this->var= $x; }
}

?>

我觉得正常的行为情况下是不应该像第一个例子那样使用static变量的,但也许你会用到(比如我),希望这些能对你有用.

你也可以通过类的实例来动态添加该实例的内部public变量,就像$instance->$param = $value 就会向$instance中动态添加了public的$param,当然这只针对该实例有效,不会对类及其他实例造成影响,其实该用法没什么卵用,只是想说php真特么强,笑尿.
```
2. 与java和C++不同的是,在循环块和if块语句中的变量可以在块外访问
```php
for($j=0;$j<3;$j++)
{
     if($j == 1)
        $a = 4;
}
echo $a;  //输出 4
```
3. 对于嵌套函数,global始终指明的是最外层的全局变量,而不是指上一层的范围,如下将不会按照预期输出
```php
// $var1 is not declared in the global scope
function a($var1){
    function b(){
        global $var1;
        echo $var1; // there is no var1 in the global scope so nothing to echo
    }
    b();
}
a('hello');
```
如果此时在`function a()`之上添加$var1 = 'some',将会得到输出结果'some'

4. 提出一段有趣的代码
```php
class obj{
    public function __destruct(){
        echo 'destruct';
    }
}

function foo ()
{
   global $testvar;
   $localvar = new obj();
   $testvar = &$localvar;
}

foo ();
var_dump($testvar);   
/*
输出
destruct
NULL
*/
```

因为对象引用是引用同一标识符,所以当方法结束后,相当于unset($localvar),此时没有其他标识符指向类实例,所以调用destruct,同时$testvar也相当于被unset了,为NULL,如果修改function如下
```php
function foo ()
{
   global $testvar;
   $localvar = new obj();
   $testvar = $localvar;  //此处将引用改为赋值
}
/*
输出
object(obj)#1 (0) {
}
destruct
*/
```
可以看到,赋值跟引用是有区别的,赋值会copy一份标识符指向类实例,所以对$localvar的释放并不会影响$testvar,所以直到程序的最后才会调用destruct.具体的赋值与引用的区别可以参见:http://segmentfault.com/a/1190000002928594

5. 关于类内方法使用static变量,1中已经提到过,这里指出,static变量不支持继承
```php
class A {
    function Z() {
        static $count =0;        
        printf("%s: %d\n",get_class($this), ++$count);
    }
}

class B extends A {}
$a = new A();
$b = new B();
$a->Z();
$a->Z();
$b->Z();
$a->Z();
?>

/*
输出:
A: 1
A: 2
B: 1
A: 3
*/
```
可以看到,类A和类B使用了不同的静态变量,即使他们使用的是同一个方法,而且就算function Z是静态方法,结果也是一样

6. 这里提一下,使用超全局$GLOBALS数组比使用global关键字更快
7. 如果static变量是一个数组,并且返回它的某个元素的时候,会返回该元素的引用
```php
function incr(&$int) {
  return $int++;
}

function return_copyof_scalar() {
  static $v;
  if (!$v)   
    $v = 1;
  return($v); 
} 

function return_copyof_arrayelement() {
  static $v;
  if (!$v) {
    $v = array();
    $v[0] =1;
  }
  return($v[0]);
} 

echo "scalar: ".
     incr(return_copyof_scalar()).
     incr(return_copyof_scalar()).
     "\n"; 
echo "arrayelement: ".
     incr(return_copyof_arrayelement()).
     incr(return_copyof_arrayelement()).
     "\n"; 
?>
/*
期望输出:
scalar:11
array element:11
*/

/*
他测试的结果:
scalar:11
array emelent:12
*/
```
但是我在php7上进行了同样的测试,发现结果跟期望输出是一样的,所以这里的数组元素并没有按照引用返回,如果我们要使用引用,应该像&function这样声明函数,也需要像&function一样调用它,但是有一个例外,就是当incr(return_copyof_scalar())这样作为参数调用的时候,不需要添加&,如此只需要在上述例子中的函数声明部分各自添加&就可以得到输出结果
```php
scalar:12
array element:12
```
8. 有时候你需在在其他多个函数中访问同一个static,同时这个static的可见范围也是非全局的,这里有一个简单的方法解决这个问题
```php
  // We need a way to get a reference of our static
  function &getStatic() {
    static $staticVar;
    return $staticVar;
  }
  // Now we can access the static in any method by using it's reference
  function fooCount() {
    $ref2static = & getStatic();
    echo $ref2static++;
  }
  fooCount(); // 0
  fooCount(); // 1
  fooCount(); // 2
```
9. 你不可以将方法里的static与传入进来的引用参数关联,但是你可以使用数组的形式对引用进行保存与操作
```php
function test($arr = null){
    static $my;
    if(!$arr)return $my[0];
    $my = $arr;
}

$you = 'hello';
test(array(&$you));
$you = 'world';
var_dump(test());
/*
输出
world
*/
```
10. 即使某个被include进来的file使用return返回一个value,该value仍然与include的文件中的同名value保持同一个访问范围
```php
$foo = 'aaa';
$bar = include('include.php');
echo($foo.' / '.$bar);

// include.php
$foo = 'bbb';
return $foo;

/*
期望输出:aaa/bbb
实际输出:bbb/bbb
*/
```
11. 一个比较有意思的代码
```php
  class A
   {
     function __destruct()
      {
        global $g_Obj;
        echo "<br>#step 2: ";
        var_dump($g_Obj);
      }

     function start()
      {
        global $g_Obj;
        echo "<br>#step 1: ";
        var_dump($g_Obj);
      }
   };

  $g_Obj = new A();       // start here
  $g_Obj->start();

?>

/*
输出
#step 1: object(A)#1 (0) { }
#step 2: object(A)#1 (0) { }
*/
```
由上可以知道，`__destruct()`是在执行完后才销毁类实例的

12. 嵌套函数需要注意重复声明以及第一次声明
```php
function norm($a, $b) {
    static $first_time = true;
    if($first_time) {
        function square($x)
        {
            return $x * $x;
        }
        $first_time = false;
    }
    return sqrt(square($a) + square($b));
}

print norm(5,4);
print square(4);
print norm(6,5);
```
该例子能正确输出结果,如果将function中的判断语句if($first_time)去掉,就会造成重复声明的错误,同时,如果在语句print norm(5,4)之前调用square函数,将会导致undefined function 的错误,必须先执行一遍外部的norm函数,告诉外部存在其内部定义声明的square函数

13. 当定义一个static变量时,你可以这样声明
```php
static $var =1; //numbers
static $var ='strings';
static $var = array(1,'a',3);//array construct
```
但是你不可以这样声明(error)
```php
static $var = some_function('arg');
static $var = (some_function('arg'));
static $var = 2+3;//any expression
static $var = new object;
```

14. 当使用远程调用php文件时,远程文件中的变量将不能在调用文件中使用
```php
// remotefile.php
$paramVal=10;

// localfile.php
include "[http://example.com/remotefile.php](http://example.com/remotefile.php)";
echo "remote-value= $paramVal";   //将不会得到预期值
```
这里提一下,本人没有亲自测试过,需要你自己转转脑瓜动动手测试下真伪