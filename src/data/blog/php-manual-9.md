---
title: "PHP手册--类型转换的判别"
author: "Joker"
pubDatetime: 2016-05-18T20:15:42+08:00
draft: false
tags:
  - "PHP"
description: "PHP官方手册中一些关于类型转换的判别有意思的讨论"
---

#### 前言
PHP手册系列文章，会挑选一些手册中有意思的评论进行翻译
手册目录: 语言参考---类型---类型转换的判别
[参考详情](https://secure.php.net/manual/zh/language.types.type-juggling.php)

#### 评论
1. 两个整数想除得到的可能是通过自动转换后的float类型结果,所以你不需要通过整数加浮点数来避免结果截断取整
```php
$dividend = 2;
$divisor = 3;
$quotient = $dividend/$divisor;
print $quotient; // 0.66666666666667
```
2. 将对象类型转换为数组类型永远是心里的痛
```php
class MyClass {
    private $priv = 'priv_value';
    protected $prot = 'prot_value';
    public $pub = 'pub_value';
    public $MyClasspriv ='second_pub_value';
}

$test = new MyClass();
echo '<pre>';
print_r((array) $test);

/* 输出
Array
(
    [MyClasspriv] => priv_value
    [*prot] => prot_value
    [pub] => pub_value
    [MyClasspriv] => second_pub_value
)
*/
```
结果看上去很正常,对象属性转换为关联数组,key是属性,value是值,并且通过在key前面添加*来标示其在对象中是protected的访问等级,但是事实远非如此
```php
foreach ((array) $test as $key =>$value) {
    $len = strlen($key);
    echo "{$key} ({$len}) => {$value}<br />";
    for ($i = 0;$i< $len; ++$i) {
        echo ord($key[$i]) .' ';
    }
    echo '<hr />';
}

/*输出
MyClasspriv (13) => priv_value
0 77 121 67 108 97 115 115 0 112 114 105 118
*prot (7) => prot_value
0 42 0 112 114 111 116
pub (3) => pub_value
112 117 98
MyClasspriv (11) => second_pub_value
77 121 67 108 97 115 115 112 114 105 118
*/
```
输出的字符码显示 protected属性转变成key的时候会添加'\0*\0',同时private属性转变成key的时候会添加'\0'.__CLASS_.'\0'

3. ++操作符不会将boolean类型转换程int类型,并且如果一个变量是boolean,值为true,那么对其++之后它还是true
```php
$a = true; 
var_dump(++$a);  // 输出 bool(true)
```
4.object 转换到 object是可以的,通过serialize/unserialize操作,详情见[序列化](http://php.net/manual/zh/function.serialize.php)
```php
class my{
    public $m = 1;
    public function test(){
        echo 'he';
    }
}


class yo{
    public $mi = 2;
    public function testi(){
        echo 'hehe';
    }
}

$b = new my();
$a = serialize($b);
echo $a;  //输出O:2:"my":1:{s:1:"m";i:1;},其中O表示object,O后面的2表示类名的长度,"my"表示类名,1表示变量个数(包括public,protected,private),s:1:"m"依次表示变量,变量名长度,变量名.所以我们要转换成别的类,不仅要替换掉类名,同时也需要替换掉类名长度
$c = unserialize($a); 

if($c == $b) echo 'succ'; //输出succ,说明$c和$b是同一个类的实例,并且属性值都相等,注意$b!==$c

$a = str_replace('my','yo',$a); //新类名长度与旧类名长度一致,所以只需要替换类名部分
echo $a;  //输出O:2:"yo":1:{s:1:"m";i:1;}
$d = unserialize($a); //新类产生

if($d instanceof yo)echo 'succ' //输出succ,是yo类的实例

echo $d->m; //1

echo $d->mi; //2

echo $d->test(); //error:undefined method

echo $d->testi(); //hehe   //如此可以知道转换后的类居然保存有旧类的变量属性,但是不具备旧类的方法属性,很神奇有木有,其实可以手动修改串O:2:"yo":1:{s:1:"m";i:1;},想添加什么变量都可以,但是注意protected的变量转变成字符串之后会添加'\0*\0',具体见上面的class转换成array
```
思考:那么旧类中的private和protected变量会不会也传递给新类呢,访问限制等级是否会发生变化呢,如果旧类中的变量的初始值是另外一个类的实例又会怎样,如果旧类extends其他类或者implements其他接口又会是怎样,这个可以自己去实验,不再一一赘述

5. 一些更短更快的方法进行类型转换
```php
$string='12345.678';
$float=+$string;
$integer=0|$string;
$boolean=!!$string;
```
6. 你应该意识到不要在对某个目标连续进行太多次类型转换,因为这样很可能意外的将false变成true
```php
if(TRUE === (boolean) (array) (int) FALSE) {
    echo 'ca';
}  // (boolean)array(0) 变成 true了
```
7. 从string转换到int或者从int转换到string是最常见的,php可以通过+.和.=来转换
```php
$x = 1;
var_dump($x);// int(1)
$x .= 1;
var_dump($x);// string(2) "11"; also an empty string ("") would cast to string without changing $x

$x = "1";
var_dump($x); // string(1) "1"
$x += 1;
var_dump($x);// int(2); also a zero value (0) would cast to int without changing $x
```
8. 提出一段很有意思的代码
```php
$obj = new stdClass();
$obj->{'4'} = 'id';
$arr = (array) $obj;
var_dump($arr);
foreach ($arr as $key => $value) {
   var_dump($key);
    var_dump($arr[$key]);
}
?>

/*
输出:
array(1) {
  ["4"]=>
  string(2) "id"
}
string(1) "4"
string(2) "id"
NULL
*/
```
发现怎么都读取不到$arr[$key],应该输出$value的值,并且通过array()构造$arr怎么都构造不出下面这个数组
```php
array(1) {
  ["4"]=>
  string(2) "id"
}
```
希望高手能解释下这个问题

9. unset看起来好像用处比较单一,但是如果你想把代码变得紧凑,你可以在同一行使用变量并且unset它
```php
$hello = 'Hello world';
$hello = (unset) print $hello;
// 等同于
$hello = 'Hello world';
print $hello;
unset($hello);
```
10. 仅仅是一些关于unset的经验之谈
```php
$var = 1;
$var_unset = (unset) $var;
$var_ref_unset &= (unset)$var;   //把与&换成或|结果也一样
var_dump($var);
var_dump($var_unset);
var_dump($var_ref_unset);

output:
int(1)
NULL
int(0)
```