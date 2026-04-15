---
title: "Yii2框架源码分析系列--creatObject"
author: "Joker"
pubDatetime: 2017-03-16T22:44:27+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "Yii2框架创建对象实例源码详细解析"
---

#### 回顾
上篇简单分析了下yii2的入口，在入口流程中include了BaseYii这个包含了全局产量定义和公用功能方法的文件，今天继续看下yii2是如何调用```Yii::createObject```来创建对象的。

#### 创建对象
 ```Yii::createObject```是new的加强版本，可以通过类名、配置数组或匿名方法来创建对象，看一下```Yii::createObject```的源码
```php
    // 主要是通过container容器来代理创建
    public static function createObject($type, array $params = [])
    {
        // 传入类名方式进行创建
        if (is_string($type)) {
            return static::$container->get($type, $params);
        } elseif (is_array($type) && isset($type['class'])) {
            // 传入数组方式进行创建，这里需要注意如果是数组方式，需要指定$type['class']来表示类名
            $class = $type['class'];
            unset($type['class']);
            return static::$container->get($class, $params, $type);
        } elseif (is_callable($type, true)) {
            // 传入匿名方法进行创建
            return static::$container->invoke($type, $params);
        } elseif (is_array($type)) {
            // 非法抛出未指定类名异常
            throw new InvalidConfigException('Object configuration must be an array containing a "class" element.');
        }
        
        // 非法抛出使用非支持的方式创建对象异常
        throw new InvalidConfigException('Unsupported configuration type: ' . gettype($type));
    }
```
从上面代码可以看到，```Yii::createObject()```主要是通过调用container的```get()```和```invoke()```来创建对象实例的，下篇将着重介绍下Yii的container容器是如何工作的