---
title: "Yii2框架源码分析系列--Service Locator"
author: "Joker"
pubDatetime: 2017-03-21T15:03:16+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "Yii2框架服务定位器源码详细解析"
---

#### 回顾
上篇介绍了yii2的DI容器Container，主要通过类构造器注入和属性注入来达到反向依赖，从而实现解耦，今天继续介绍下用于解耦的服务定位器Service Locator

#### Service Locator
在yii2中Service Locator由`yii\di\ServiceLocator`来实现。 从代码组织上，yii2将Service Locator放到与DI同一层次来对待，都组织在 yii\di 命名空间下

#### 类属性和方法
ServiceLocator类中包含以下一些属性和方法
```php
// 保存对应id的组件实例
private $_components = []

// 保存对应id的组件定义和配置
private $_definitions = []

// 注册组件
public function set()

// 批量注册组件
public function setComponents()

// 获取组件实例
public function get()
```
#### 源码解析
首先看下`set()`方法
```php
    public function set($id, $definition)
    {
        // 重新注册，之前的实例无效
        unset($this->_components[$id]);
        
        // 当$definition为null时，表示取消注册，删除$id对应的配置
        if ($definition === null) {
            unset($this->_definitions[$id]);
            return;
        }
        
        if (is_object($definition) || is_callable($definition, true)) {
            // 对象或者方法
            $this->_definitions[$id] = $definition;
        } elseif (is_array($definition)) {
            // 数组，需要检查是否有配置类名
            if (isset($definition['class'])) {
                $this->_definitions[$id] = $definition;
            } else {
                throw new InvalidConfigException("The configuration for the \"$id\" component must contain a \"class\" element.");
            }
        } else {
            throw new InvalidConfigException("Unexpected configuration type for the \"$id\" component: " . gettype($definition));
        }
    }
```
可以看到`set()`方法不仅支持注册，也支持取消注册，注册的流程主要就是存储`id`以及对应的配置到`_definitions`数组中，`setComponents()`方法是通过循环调用`set()`方法进行批量处理，很简单，这里不再细说，接下来看下获取组件实例`get()`方法
```php
    public function get($id, $throwException = true)
    {
        // 已存在实例，直接返回
        if (isset($this->_components[$id])) {
            return $this->_components[$id];
        }

        if (isset($this->_definitions[$id])) {
            // 获取对应id的组件配置
            $definition = $this->_definitions[$id];
            if (is_object($definition) && !$definition instanceof Closure) {
                // 是对象且不是Closure对象，直接返回
                return $this->_components[$id] = $definition;
            }

            // 通过Yii::createObject()来创建实例，这里就会用到Container
            return $this->_components[$id] = Yii::createObject($definition);
        } elseif ($throwException) {
            throw new InvalidConfigException("Unknown component ID: $id");
        }

        return null;
    }
```
`get()`方法的流程也很简单，无非就是对不同的配置进行对应的处理，细节如何生成实例，直接交给我们的类构造器`Yii::createObject()`和DI容器`Container`去实现就行啦
yii2中一个比较典型的使用Service Locator 的例子就是`config`配置中的`components`，先搂一眼，后面还会详细来说
```php
$config = [
    'id' => 'basic',
    'basePath' => dirname(__DIR__),
    'bootstrap' => ['log'],
    'components' => [
        'request' => [
            // !!! insert a secret key in the following (if it is empty) - this is required by cookie validation
            'cookieValidationKey' => 'PCsOg_dM2lUY4iFEpeFrAfkKMrDQv-wR',
            'enableCsrfValidation' => false,
        ],
        'cache' => [
            'class' => 'yii\caching\FileCache',
        ],
        'user' => [
            'identityClass' => 'app\models\User',
            'enableAutoLogin' => true,
        ],
        'errorHandler' => [
            //'errorAction' => 'site/error',
            'class' => 'app\exception\ErrorHandler',
        ],
        'mailer' => [
            'class' => 'yii\swiftmailer\Mailer',
            'useFileTransport' => true,
        ],
        'log' => [
            'traceLevel' => YII_DEBUG ? 3 : 0,
            'targets' => [
                [
                    'class' => 'yii\log\FileTarget',
                    'levels' => ['error', 'warning'],
                ],
            ],
        ],
        'urlManager' => [
            'enablePrettyUrl' => true,
            'showScriptName' => false,
            'rules' => [
            ],
        ],

    ],
    'params' => $params,
];
```
先不管里面内容是什么，我们只需要知道，config中的components就会通过Service Locator来注册组件

#### 总结
yii2的服务定位器大概就介绍到这里了，相比于Container要好理解的多，服务定位器在注册组件和获取组件的过程中又会使用到Container，两者相辅相成，yii2框架中很多地方都会用到这两位大佬，至于细节上面的联系，后面慢慢介绍的过程中再来解开层层面纱

#### 补充
这里还有一点要注意下，`get()`方法调用`Yii::createObject()`方法时只传递了`$definition`这一个参数，没有传递$params参数