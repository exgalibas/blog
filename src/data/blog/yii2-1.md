---
title: "Yii2框架源码分析系列--入口"
author: "Joker"
pubDatetime: 2017-03-15T22:25:25+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "Yii2框架入口源码详细解析"
---

#### 写在开始
用了yii2框架也有一年的时间了，挺喜欢yii2的，期间也根据工作需要看过一些源码，在此写一个系列的文章，主要是剖析下yii2框架的启动流程和内部核心的一些代码，借此做下笔记回顾一下，加深对yii2的理解。yii2-basic和yii2-advanced核心部分的原理和代码基本一致，偷个懒使用简单版的yii2-basic作为剖析对象。

#### 入口
yii2也是单入口框架，入口文件是```/basic/web/index.php```(/basic表示框架根目录)，下面看一下代码
```php
require(__DIR__ . '/../vendor/autoload.php'); // 加载composer的autoload
require(__DIR__ . '/../vendor/yiisoft/yii2/Yii.php'); // 加载Yii.php
$config = require(__DIR__ . '/../config/web.php'); //加载配置
(new yii\web\Application($config))->run(); // 开始执行
```
composer的autoload详细可以到[composer中文文档](https://docs.phpcomposer.com/)中了解下，如果你还不了解composer这个包管理器，务必先了解下。下面继续看下Yii.php的代码
```php
require(__DIR__ . '/BaseYii.php'); // 加载BaseYii.php
class Yii extends \yii\BaseYii
{
}
spl_autoload_register(['Yii', 'autoload'], true, true); // 注册自定义autoload
Yii::$classMap = require(__DIR__ . '/classes.php'); // 加载框架的类映射文件
Yii::$container = new yii\di\Container(); // 初始化容器，yii2的container会在后面系列中说到
```
先看下yii2的类加载器
```php
    public static function autoload($className)
    {
        // 先在Yii::$classMap即上面的__DIR__ . '/classes.php'中找是否有对应的类映射，如果有获取对应的类文件路径并检查替换别名，关于设置和替换别名这里不再赘述
        if (isset(static::$classMap[$className])) {
            $classFile = static::$classMap[$className];
            if ($classFile[0] === '@') {
                $classFile = static::getAlias($classFile);
            }
        } elseif (strpos($className, '\\') !== false) {
            // 对于使用命名空间类的加载
            $classFile = static::getAlias('@' . str_replace('\\', '/', $className) . '.php', false);
            if ($classFile === false || !is_file($classFile)) {
                // 没有找到类文件，直接返回
                return;
            }
        } else {
            // 没有找到类文件，直接返回，会继续使用composer的autoload进行解析
            return;
        }

        // 找到文件，include进来
        include($classFile);

        // 如果传进来的$className不是类、接口或trait，抛出异常
        if (YII_DEBUG && !class_exists($className, false) && !interface_exists($className, false) && !trait_exists($className, false)) {
            throw new UnknownClassException("Unable to find '$className' in file: $classFile. Namespace missing?");
        }
    }
```

Yii.php中创建了一个空的class Yii来继承\yii\BaseYii，同时由入口文件直接require，所以Yii类的生命周期与框架的生命周期一致，作用域全局，同时Yii也继承了一些通用的方法和全局的变量，一起来看看BaseYii中都有些什么
```php
// 常量的定义，具有全局作用域
// 设置框架启动时间
defined('YII_BEGIN_TIME') or define('YII_BEGIN_TIME', microtime(true));
// 定义框架根目录 即yiisoft目录的路径
defined('YII2_PATH') or define('YII2_PATH', __DIR__);
// 设置是否在debug模式下运行
defined('YII_DEBUG') or define('YII_DEBUG', false);
// 设置运行环境，默认情况下是生产环境即prod，除此之外还有dev、test和staging
defined('YII_ENV') or define('YII_ENV', 'prod');
// 标志是否运行在prod环境
defined('YII_ENV_PROD') or define('YII_ENV_PROD', YII_ENV === 'prod');
// 标志是否运行在dev环境
defined('YII_ENV_DEV') or define('YII_ENV_DEV', YII_ENV === 'dev');
// 标志是否在test环境
defined('YII_ENV_TEST') or define('YII_ENV_TEST', YII_ENV === 'test');
// 标志是否允许设置error handler，默认允许
defined('YII_ENABLE_ERROR_HANDLER') or define('YII_ENABLE_ERROR_HANDLER', true);

// 对象属性的声明
// yii2内部类映射文件，用于加速autoload
public static $classMap = [];
// yii2 命令行模式和web模式下的应用实例
public static $app;
// 别名数组，初始化yii别名 
public static $aliases = ['@yii' => __DIR__];
// DI容器，用于创建对象，在Yii.php中定义
public static $container;

// 对象方法
// 获取当前yii2框架的版本
public static function getVersion;
// 获取别名
public static function getAlias;
// 获取根别名
public static function getRootAlias
// 设置别名
public static function setAlias
// 内部类自动加载方法
public static function autoload
// 类构造器
public static function createObject
// 获取日志实例
public static function getLogger
// 设置日志对象
public static function setLogger
// 四中类型的日志记录，这些在日志部分再细说
public static function trace
public static function error
public static function warning
public static function info
// 标记用于分析的代码块的开始和结束
public static function beginProfile
public static function endProfile
// 配置对象属性
public static function configure
// 获取对象的public属性，避免类内调用get_object_vars返回私有属性，增加安全性
public static function getObjectVars
```