---
title: "Yii2框架源码分析系列--container"
author: "Joker"
pubDatetime: 2017-03-18T14:36:57+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "Yii2框架容器源码详细解析"
---

#### 回顾
上篇简单介绍了下yii2是如何通过```Yii::createObject```来创建对象的，其实这个方法只是简单的定义创建规则和包装而已，真正的核心是今天的主角--container

#### container
yii2中container也称之为DI容器，即依赖注入容器，关于反向依赖的概念这里就不赘述了。总而言之就是在你使用container创建对象的时候不需要关心该对象是否有其他依赖，container都自动帮你解析并把这些依赖注入进去，你只需要通过```set()```方法提前声明依赖，然后通过```get()```方法来获取

#### Container类
yii2通过```yii\di\Container```类来实现DI容器，该类包含如下一些重要的属性和方法
```php
// 保存对象单例实例
private $_singletons = []

// 保存类依赖的定义
private $_definitions = []

// 保存初始化类传入的参数
private $_params = []

// 保存类反射对象
private $_reflections = []

// 保存类依赖，主要通过反射解析类构造函数所需构造参数
private $_dependencies = []

// 声明类依赖，用于实例化
public function set()

// 同set()方法，唯一不同是通过该方法声明的类依赖在创建时返回单例而不是新的实例
public function setSingleton()

// 被set()方法调用，用于检查类定义是否符合规范并规范格式
protected function normalizeDefinition()

// 获取某个对象的实例，该方法会递归解析依赖关系并逐个实例化
public function get()

// 创建对象实例
protected function build()

// 获取类反射对象和类依赖信息
protected function getDependencies()

// 解析依赖
protected function resolveDependencies()
```

接下来看下```set()```是如何运作的
```php
    public function set($class, $definition = [], array $params = [])
    {
        // 向属性_definitions中添加类依赖，key使用传入的$class标记，可以是类名、接口名或别名
        $this->_definitions[$class] = $this->normalizeDefinition($class, $definition);
        // 向属性_params中添加类实例化所传参数，key同上
        $this->_params[$class] = $params;
        // 把_singletons数组对应的键unset掉，用于告诉get方法创建新的实例而不使用单例
        unset($this->_singletons[$class]);
        // 支持链式调用
        return $this;
    }
    
    // 主要是检查依赖定义是否合法，并且规范化，通过该方法我们可以知道有哪些set的方式来定义类
    protected function normalizeDefinition($class, $definition)
    {
        if (empty($definition)) {
            // 定义为空，默认使用$class作为类名
            return ['class' => $class];
        } elseif (is_string($definition)) {
            // 依赖是字符串，使用该字符串作为类名
            return ['class' => $definition];
        } elseif (is_callable($definition, true) || is_object($definition)) {
            // 依赖是合法的可调用结构或者是对象，直接返回定义
            return $definition;
        } elseif (is_array($definition)) {
            // 依赖是数组
            if (!isset($definition['class'])) {
                // 没有在依赖中配置类名，使用传入的$class
                if (strpos($class, '\\') !== false) {
                    $definition['class'] = $class;
                } else {
                    // 依赖中缺少类名，抛出异常
                    throw new InvalidConfigException("A class definition requires a \"class\" member.");
                }
            }
            return $definition;
        } else {
            // 不支持的格式，抛出异常
            throw new InvalidConfigException("Unsupported definition type for \"$class\": " . gettype($definition));
        }
    }
```
再看下```setSingleton()```与```set()```有什么不同
```php
    public function setSingleton($class, $definition = [], array $params = [])
    {
        $this->_definitions[$class] = $this->normalizeDefinition($class, $definition);
        $this->_params[$class] = $params;
        // 只是这里与set()不同，这里没有使用unset，保留了键$class，在get()中会检查是否有这个键，如果有会以单例模式创建对象而不是新的实例
        $this->_singletons[$class] = null;
        return $this;
    }
```
以上就是container中定义依赖的过程，比较直观，下面看下```get()```方法的具体实现流程
```php
    public function get($class, $params = [], $config = [])
    {
        // params参数用于传递给类构造函数
        // config参数用于其他配置
        if (isset($this->_singletons[$class])) {
            // 如果已经有实例化，说明依赖不可能是通过set()(因为在该方法中unset掉了)方法设置的，返回已经实例化的单例即可
            return $this->_singletons[$class];
        } elseif (!isset($this->_definitions[$class])) {
            // 没有定义依赖，不需要解析，直接调用build创建
            return $this->build($class, $params, $config);
        }
        
        // 取出指定的依赖
        $definition = $this->_definitions[$class];

        if (is_callable($definition, true)) {
            // 匿名函数
            // 合并类依赖定义中的params和传入的params
            // 并调用resolveDependencies方法解析依赖，因为合并后的params中可能包含对其他类或者接口的依赖
            $params = $this->resolveDependencies($this->mergeParams($class, $params));
            // 调用方法
            $object = call_user_func($definition, $this, $params, $config);
        } elseif (is_array($definition)) {
            // 数组
            // 取出数组中的类名(类、接口或别名)
            $concrete = $definition['class'];
            // 剩下的就是其他的配置了
            unset($definition['class']);
            // 合并设置的依赖配置和传入的配置
            $config = array_merge($definition, $config);
            // 合并设置的依赖构造参数和传入的构造参数
            $params = $this->mergeParams($class, $params);
            
            if ($concrete === $class) {
                // 如果不是别名，调用build直接创建
                $object = $this->build($class, $params, $config);
            } else {
                // 否则递归继续解析
                $object = $this->get($concrete, $params, $config);
            }
        } elseif (is_object($definition)) {
            // 传入的是对象实例，默认直接使用单例模式，没有必要再new一个了
            return $this->_singletons[$class] = $definition;
        } else {
            // 依赖格式不对，抛出异常
            throw new InvalidConfigException('Unexpected object definition type: ' . gettype($definition));
        }
        
        // 这里就是区分set()和setSingleton()的流程
        // 如果在单例缓存数组中有指定的key就使用单例模式
        // 如果没有就直接返回，不适用单例模式(见set()方法中的unset逻辑)
        if (array_key_exists($class, $this->_singletons)) {
            // singleton
            $this->_singletons[$class] = $object;
        }
          
        return $object;
    }
```
```get()```方法中创建对象实例主要使用```build()```方法进行创建，看看具体的实现
```php
    protected function build($class, $params, $config)
    {
        // 调用getDependencies方法获取类反射对象和依赖信息
        list($reflection, $dependencies) = $this->getDependencies($class);

        // 解析后的$dependencies包含了类构造函数所需参数
        // 按照索引有序地使用$params替换$dependencies
        // 该步骤主要是初始化所有简单类型的依赖，也可以初始化非简单类型的依赖
        foreach ($params as $index => $param) {
            $dependencies[$index] = $param;
        }
        
        // 替换完后继续检查是否还存在依赖，如果存在则解析依赖
        $dependencies = $this->resolveDependencies($dependencies, $reflection);
        
        if (!$reflection->isInstantiable()) {
            // 无法实例化，抛出异常
            throw new NotInstantiableException($reflection->name);
        }
        if (empty($config)) {
            // 没有额外配置信息，直接使用反射方法创建实例
            return $reflection->newInstanceArgs($dependencies);
        }
        // 解析配置信息中的依赖
        $config = $this->resolveDependencies($config);

        if (!empty($dependencies) && $reflection->implementsInterface('yii\base\Configurable')) {
            // 这里定义了一个规则
            // 如果你要在构造函数中使用config配置，需要你的指定类中继承Configurable接口，这个接口没有实现任何方法，只是内部的一个约定，即继承该接口的类的构造函数中以$config = []作为最后一个参数
            // 替换最后一个参数为解析后的$config
            $dependencies[count($dependencies) - 1] = $config;
            return $reflection->newInstanceArgs($dependencies);
        }

        $object = $reflection->newInstanceArgs($dependencies);
        // 不通过构造函数注入config，默认使用魔术方法注入到类属性中
        // 可以在类中自己实现__set()魔术方法或者继承BaseObject
        foreach ($config as $name => $value) {
            $object->$name = $value;
        }
        return $object;
    }
```
分析上面两个方法可以大致知道获取实例的一些重要步骤，如解析依赖，合并配置，合并构造参数，缓存单例以及创建实例，那么解析依赖是如何实现的呢，先看看```getDependencies()```方法
```php
    protected function getDependencies($class)
    {
        // 缓存中有直接返回即可
        if (isset($this->_reflections[$class])) {
            return [$this->_reflections[$class], $this->_dependencies[$class]];
        }
        // 初始化空数组
        $dependencies = [];
        // 反射对象
        $reflection = new ReflectionClass($class);
        // 获取构造函数
        $constructor = $reflection->getConstructor();
        if ($constructor !== null) {
            foreach ($constructor->getParameters() as $param) {
                if (version_compare(PHP_VERSION, '5.6.0', '>=') && $param->isVariadic()) {
                    // 可变参数，那么一定是普通类型咯，也不会有默认值咯，直接忽略就行啦
                    break;
                } elseif ($param->isDefaultValueAvailable()) {
                    // 把默认值放到依赖中
                    $dependencies[] = $param->getDefaultValue();
                } else {
                    // 没有默认值，获取参数类型提示
                    // 简单类型会返回null
                    $c = $param->getClass();
                    // 创建Instance类实例来，并使用类型名初始化该类的id属性
                    // container类只用到了Instance类的很少一部分功能，这里不细说，主要是通过Instance类的id属性来判断是哪种依赖
                    $dependencies[] = Instance::of($c === null ? null : $c->getName());
                }
            }
        }

        // 保存对应的类反射对象，后续可以直接使用
        $this->_reflections[$class] = $reflection;
        // 保存对应的类依赖信息，后续可以直接使用
        $this->_dependencies[$class] = $dependencies;

        return [$reflection, $dependencies];
    }
```
获取到了依赖，就该解析依赖了，在```build()```方法也是首先调用```getDependencies()```获取到依赖信息，然后使用合并后的params去做对应位置的替换，最后再调用```resolveDependencies()```对依赖信息进行解析，保证所有依赖都有对应的值或者对象实例，看看解析依赖的实现
```php
    protected function resolveDependencies($dependencies, $reflection = null)
    {
        // 遍历依赖
        foreach ($dependencies as $index => $dependency) {
            if ($dependency instanceof Instance) {
                // 除了有值的依赖，其他的都被构造成Instance实例
                if ($dependency->id !== null) {
                    // id不为null，说明不是简单类型，继续调用get方法获取该类型对应的实例
                    $dependencies[$index] = $this->get($dependency->id);
                } elseif ($reflection !== null) {
                    // 是简单类型，没有传值
                    // 有反射对象，说明是构造函数必须的参数
                    // 没有在build方法中的params替换步骤中给值，直接抛出异常
                    $name = $reflection->getConstructor()->getParameters()[$index]->getName();
                    $class = $reflection->getName();
                    throw new InvalidConfigException("Missing required parameter \"$name\" when instantiating \"$class\".");
                }
            }
        }

        return $dependencies;
    }
```

以上就是Yii2中DI容器Container类的源码解析，当然，该类中还有其他一些独立功能的方法，比如在```Yii::createObject()```中调用的```invoke()```方法，该方法也是通过反射方法类来解析依赖的，这里就不再赘述了，原理基本相同，有兴趣自己看一下