---
title: "Yii2框架源码分析系列--Application"
author: "Joker"
pubDatetime: 2017-03-22T20:03:58+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "Yii2框架应用实例源码详细解析"
---

#### 回顾
之前聊入口的时候聊到了`Yii::createObject()`，然后又跟着这条线解析了下`Container`和`Service Locator`，有点偏离了，今天继续从入口分析下yii2的Application

#### Application
入口`index.php`的最后一行代码`(new yii\web\Application($config))->run()`直接新建一个Application实例并调用对应的`run()`方法，这里就正式进入到了框架的应用层面，来看下这个类的构造方法
```php
    public function __construct($config = [])
    {
        // 初始化BaseYii类中的$app属性，赋值$this
        // 使得全局可访问应用实例
        Yii::$app = $this;

        // 调用Module类的方法
        static::setInstance($this);
        
        // 设置启动状态
        $this->state = self::STATE_BEGIN;
        
        // 一些初始化工作
        $this->preInit($config);

        // 注册错误处理
        $this->registerErrorHandler($config);

        // 调用组件构造函数
        Component::__construct($config);
    }
```
看下初始化都干了些啥
```php
    public function preInit(&$config)
    {
        // 应用ID都没有，死去吧
        if (!isset($config['id'])) {
            throw new InvalidConfigException('The "id" configuration for the Application is required.');
        }
        // 设置项目根路径
        // 会使用别名app代替
        if (isset($config['basePath'])) {
            $this->setBasePath($config['basePath']);
            unset($config['basePath']);
        } else {
            throw new InvalidConfigException('The "basePath" configuration for the Application is required.');
        }
        
        // 设置vendor路径
        // 会使用别名vendor
        if (isset($config['vendorPath'])) {
            $this->setVendorPath($config['vendorPath']);
            unset($config['vendorPath']);
        } else {
            // 获取默认vendor路径，并设置别名vendor
            $this->getVendorPath();
        }
  
        // 同上，设置运行时路径
        if (isset($config['runtimePath'])) {
            $this->setRuntimePath($config['runtimePath']);
            unset($config['runtimePath']);
        } else {
            // set "@runtime"
            $this->getRuntimePath();
        }

        // 同上，设置时区
        if (isset($config['timeZone'])) {
            $this->setTimeZone($config['timeZone']);
            unset($config['timeZone']);
        } elseif (!ini_get('date.timezone')) {
            $this->setTimeZone('UTC');
        }

        // 初始化容器，可以设置一些依赖配置
        if (isset($config['container'])) {
            $this->setContainer($config['container']);
            unset($config['container']);
        }

        // 配置一些核心的组件
        // 这些组件你可以不适用框架默认的，但是必须得有
        // coreComponents()方法中包含了核心组件
        foreach ($this->coreComponents() as $id => $component) {
            if (!isset($config['components'][$id])) {
                // 直接配置
                $config['components'][$id] = $component;
            } elseif (is_array($config['components'][$id]) && !isset($config['components'][$id]['class'])) {
                // 这是配置了一些参数，增加对应的组件类
                $config['components'][$id]['class'] = $component['class'];
            }
        }
    }
```
`Application`类主要是根据传入的配置做一些路径初始化，设置实例和状态以及组件配置的检查和补充，再看看`Component`类的构造函数
```php
// Component是继承父类的构造函数的，所以这里调用的是框架的基类BaseObject的构造函数
public function __construct($config = [])
    {
        if (!empty($config)) {
            // 调用BaseYii的configure方法
            Yii::configure($this, $config);
        }
        // 初始化
        $this->init();
    }
```
`Yii::configure()`方法逻辑很简单，就是遍历`config`设置类属性，这里的`config`就是入口传进来并经过`Application`类处理过的配置，yii2中通过魔术方法`__set()`来针对不同的配置来进行不同的动作，根据这条线，可以知道设置属性的主角是`Component`类的`__set()`方法，来看看它干了些什么
```php
    public function __set($name, $value)
    {
        $setter = 'set' . $name;
        // 如果有对应的setName方法直接调用
        // 如config中有一个组件配置['components' => []]
        // 此时name=components
        // 调用setComponents方法，这个方法不陌生吧，正是之前介绍的Service Locator类中的方法
        // Application 继承 Module 继承Service Locator 继承 Component 继承BaseObject
        if (method_exists($this, $setter)) {
            $this->$setter($value);
            return;
        } elseif (strncmp($name, 'on ', 3) === 0) {
            // 格式 on event，绑定事件处理
            // Component类的一个巨大特性就是支持行为事件，这里先埋着，后面挖出来介绍
            $this->on(trim(substr($name, 3)), $value);
            return;
        } elseif (strncmp($name, 'as ', 3) === 0) {
            // 格式 as behavior，绑定行为
            $name = trim(substr($name, 3));
            $this->attachBehavior($name, $value instanceof Behavior ? $value : Yii::createObject($value));
            return;
        }
        // 确保所有行为已绑定，这个后面单独讲Component的时候再介绍
        $this->ensureBehaviors();
        foreach ($this->_behaviors as $behavior) {
            if ($behavior->canSetProperty($name)) {
                // 设置行为属性
                $behavior->$name = $value;
                return;
            }
        }

        if (method_exists($this, 'get' . $name)) {
            throw new InvalidCallException('Setting read-only property: ' . get_class($this) . '::' . $name);
        }

        throw new UnknownPropertyException('Setting unknown property: ' . get_class($this) . '::' . $name);
    }
```
这里说一下，到这里`config`中的`components`会注册到服务定位器中，如
```php
$config = [
         'components' => [
                'user' => [
                      'identityClass' => 'app\models\User',
                      'enableAutoLogin' => true,
                ],
          ]
]
```
注册完之后你就可以在程序中通过`Yii::$app->user`来获取到`user`组件的实例了，因为这里会调用Service Locator类的`__get()`方法，继而调用`get()`方法，继而调用`Yii::createObject()`方法使用Container容器实例化出来。`BaseObject`类执行完配置之后会继续调用`Application`类的`init()`方法
```php
    public function init()
    {
        // 设置状态为初始化
        $this->state = self::STATE_INIT;
        // 调用bootstrap方法，初始化yii2扩展组件
        $this->bootstrap();
    }
```
`init()`方法就干了两件事，首先设置应用执行状态为初始化，然后调用本来的`bootstrap()`方法，这里不再详细介绍。`Application`类的构造函数执行完毕了，现在该执行`run()`方法了
```php
    // 正如函数名所描述，前置的初始化和配置以及加载扩展都弄完了，万事俱备，开始执行
    public function run()
    {
        try {
            // 执行请求开始前的事件
            $this->state = self::STATE_BEFORE_REQUEST;
            $this->trigger(self::EVENT_BEFORE_REQUEST);
            
            // 执行请求
            $this->state = self::STATE_HANDLING_REQUEST;
            $response = $this->handleRequest($this->getRequest());

            // 执行请求完毕后的事件
            $this->state = self::STATE_AFTER_REQUEST;
            $this->trigger(self::EVENT_AFTER_REQUEST);

            // 执行返回
            $this->state = self::STATE_SENDING_RESPONSE;
            $response->send();

            // 执行结束
            $this->state = self::STATE_END;
            return $response->exitStatus;
        } catch (ExitException $e) {
            $this->end($e->statusCode, isset($response) ? $response : null);
            return $e->statusCode;
        }
    }
```
随着`run()`执行完毕，应用也就执行完毕了，yii2的整个生命周期就结束了，至于请求是如何被执行的，怎么解析url，怎么定位到controller，又怎么定位到action等等，这个后面的篇幅再继续介绍