---
title: "Yii2框架源码分析系列--事件"
author: "Joker"
pubDatetime: 2017-03-30T20:23:00+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "Yii2框架事件源码详细解析"
---

#### 回顾
上一篇聊了下yii2的`Application`，本来这篇应该继续后面的url解析了，但是有些前置知识还是需要提前解释，所以今天来介绍下yii2中的事件`Event`

#### Event
事件是yii2中一个非常重要的特性，可以很好的实现代码解耦，同时也是一种流行的任务流程设计模式 ，我们在业务处理中，都会碰到针对某个触发点而执行一个或多个事件的情况，而某些事件又可以埋到多个触发点，实现代码复用

#### 实现
yii2中事件的实现主要通过`Component`类和`Event`类来实现，`Event`类是所有事件的基类，其中囊括了事件所需的参数和方法，直接看代码
```php
class Event extends BaseObject
{
    // 事件名
    public $name;
    // 事件发布者
    public $sender;
    // 是否终止后续事件的执行，默认不终止
    public $handled = false;
    // 事件相关数据
    public $data;

    // 全局记录已注册事件
    private static $_events = [];
    // 全局记录已注册通配符模式事件
    private static $_eventWildcards = [];

    // 绑定类级别事件handler
    public static function on($class, $name, $handler, $data = null, $append = true)
    {
        $class = ltrim($class, '\\');

        // 类名或者事件名中有通配符，走通配符模式
        if (strpos($class, '*') !== false || strpos($name, '*') !== false) {
            if ($append || empty(self::$_eventWildcards[$name][$class])) {
                // 尾部添加到_eventWildcards静态数组中
                self::$_eventWildcards[$name][$class][] = [$handler, $data];
            } else {
                // 头部添加到_eventWildcards静态数组中
                array_unshift(self::$_eventWildcards[$name][$class], [$handler, $data]);
            }
            return;
        }

        if ($append || empty(self::$_events[$name][$class])) {
            // 尾部添加到_events静态数组中
            self::$_events[$name][$class][] = [$handler, $data];
        } else {
            // 头部添加到_events静态数组中
            array_unshift(self::$_events[$name][$class], [$handler, $data]);
        }
    }

    // 解绑类级别事件handler
    public static function off($class, $name, $handler = null)
    {
        $class = ltrim($class, '\\');
        if (empty(self::$_events[$name][$class]) && empty(self::$_eventWildcards[$name][$class])) {
            // 本来就没有绑定，直接返回false
            return false;
        }
        // 解绑所有handler
        if ($handler === null) {
            // 完全匹配模式解绑
            unset(self::$_events[$name][$class]);
            // 通配符模式解绑
            unset(self::$_eventWildcards[$name][$class]);
            return true;
        }

        // 解绑指定handler，完全匹配模式
        if (isset(self::$_events[$name][$class])) {
            $removed = false;
            foreach (self::$_events[$name][$class] as $i => $event) {
                if ($event[0] === $handler) {
                    // 找到指定的handler并解绑
                    unset(self::$_events[$name][$class][$i]);
                    // 设置解绑标识
                    $removed = true;
                }
            }
            if ($removed) {
                // 重新索引
                // 因为是数字索引，unset会造成索引值跳跃
                self::$_events[$name][$class] = array_values(self::$_events[$name][$class]);
                return $removed;
            }
        }

        // 解绑指定handler，通配符匹配模式
        $removed = false;
        foreach (self::$_eventWildcards[$name][$class] as $i => $event) {
            if ($event[0] === $handler) {
                // 找到指定的handler并解绑
                unset(self::$_eventWildcards[$name][$class][$i]);
                // 设置解绑标识
                $removed = true;
            }
        }
        if ($removed) {
            // 重新索引
            self::$_eventWildcards[$name][$class] = array_values(self::$_eventWildcards[$name][$class]);
            // 解绑之后处理掉空的数组元素
            // 这么做主要是为了减少后续正则匹配的消耗
            if (empty(self::$_eventWildcards[$name][$class])) {
                unset(self::$_eventWildcards[$name][$class]);
                if (empty(self::$_eventWildcards[$name])) {
                    unset(self::$_eventWildcards[$name]);
                }
            }
        }

        return $removed;
    }

    // 解绑所有类级别事件handler
    public static function offAll()
    {
        // 直接全部置空
        self::$_events = [];
        self::$_eventWildcards = [];
    }

    // 判断是否
    public static function hasHandlers($class, $name)
    {
        if (empty(self::$_eventWildcards) && empty(self::$_events[$name])) {
            // 没绑定过，那绝对不存在了
            // 这里判断的是_eventWildcards而不是_eventWildcards[$name]，主要是因为该数组是以通配符模式保存的，并不能直接定位到$name
            return false;
        }

        if (is_object($class)) {
            // 获取对象名
            $class = get_class($class);
        } else {
            $class = ltrim($class, '\\');
        }
        // 这里需要说明下
        // 子类继承父类会同时会拥有父类绑定的事件
        // 类实现接口也会拥有接口绑定的事件
        // 所以你要找某个类某个事件是否绑定了handler，也需要判断其继承的所有父类和实现的所有接口
        $classes = array_merge(
            [$class],
            class_parents($class, true),
            class_implements($class, true)
        );

        // 完全匹配模式下查找绑定
        foreach ($classes as $class) {
            if (!empty(self::$_events[$name][$class])) {
                return true;
            }
        }

        // 通配符匹配模式下查找绑定
        foreach (self::$_eventWildcards as $nameWildcard => $classHandlers) {
            // 这里使用yii2的Helper类中的方法，用于匹配通配符模式，这里不赘述该方法，有兴趣可以自己查阅
            // 先找到匹配的事件名name
            if (!StringHelper::matchWildcard($nameWildcard, $name)) {
                continue;
            }
            // 再匹配类名class
            foreach ($classHandlers as $classWildcard => $handlers) {
                if (empty($handlers)) {
                    // 没有绑定handler，直接跳过
                    continue;
                }
                foreach ($classes as $class) {
                    // 循环匹配所有类名，父类名，接口名
                    // 这里使用了!，仔细看matchWildcard这个方法了，里面会把\*这样的格式转换成[*]来处理，这个是有问题的，具体什么问题，感兴趣的可以评论里交流，这里就不说了，尽量不要滥用通配符匹配模式
                    if (!StringHelper::matchWildcard($classWildcard, $class)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    // 触发类级别事件
    public static function trigger($class, $name, $event = null)
    {
        $wildcardEventHandlers = [];
        // 获取通配符模式下匹配name的所有handler
        foreach (self::$_eventWildcards as $nameWildcard => $classHandlers) {
            if (!StringHelper::matchWildcard($nameWildcard, $name)) {
                continue;
            }
            $wildcardEventHandlers = array_merge($wildcardEventHandlers, $classHandlers);
        }

        // 没有对应的handler，无法执行，直接返回
        if (empty(self::$_events[$name]) && empty($wildcardEventHandlers)) {
            return;
        }

        // 这里注意到trigger方法的第三个参数event应该是一个event类实例，主要是通过event类中的private属性来统一规范传递给handler的参数
        if ($event === null) {
            // 没有就自己造一个，这里用了延迟绑定，可用于子类调用
            $event = new static();
        }
        // 一些初始化
        $event->handled = false;
        $event->name = $name;

        if (is_object($class)) {
            if ($event->sender === null) {
                // 如果传的是对象，并且sender=null，直接将对象赋值给sender
                $event->sender = $class;
            }
            $class = get_class($class);
        } else {
            $class = ltrim($class, '\\');
        }

        // 老规矩，组装本类名，父类名，接口名
        $classes = array_merge(
            [$class],
            class_parents($class, true),
            class_implements($class, true)
        );

        foreach ($classes as $class) {
            // 单次循环要执行的handler
            // 也就是按照类的层级，从子类到父类再到接口逐步执行对应的handler
            $eventHandlers = [];
            foreach ($wildcardEventHandlers as $classWildcard => $handlers) {
                if (StringHelper::matchWildcard($classWildcard, $class)) {
                    // 收集通配符模式下匹配到的handler
                    $eventHandlers = array_merge($eventHandlers, $handlers);
                    // 这里每次匹配到一次之后应该unset掉，因为可能会导致重复执行
                    // 这里需要注意下，因为父类和子类可能使用的同一个匹配模式，所以，父类和子类的handler可能是交叉执行的，并不是按照层级递增来调用
                    unset($wildcardEventHandlers[$classWildcard]);
                }
            }

            // 收集完全匹配模式下的handler
            if (!empty(self::$_events[$name][$class])) {
                // 这里就不用unset了，因为具有唯一性
                $eventHandlers = array_merge($eventHandlers, self::$_events[$name][$class]);
            }

            // 执行单次循环收集到的handler，并把组装的event实例作为参数传进去
            foreach ($eventHandlers as $handler) {
                // 初始化data，这个data就是on()方法在绑定的时候定义的
                $event->data = $handler[1];
                // 这里是真正执行的位置
                // 不用我说你也知道吧，on()传入的handler的格式得遵循call_user_func的规则
                call_user_func($handler[0], $event);
                if ($event->handled) {
                    // 执行终止
                    // 这里传的是对象event，我们都知道event作为参数传递是引用传递，所以任何一个handler都可以在执行过程中将event的handled置为true，终止后面的handler，这也是为什么要硬性规定传递event对象作为参数的理由吧
                    return;
                }
            }
        }
    }
}
```
上面的代码中旧版是没有通配符匹配模式的，在2.0.14中加入的，但是我觉得这个没有实现好，上面注释有说明，而且从允许handler执行终止来看，handler的执行顺序是很重要的，但是通配符模式中并没有把控好这个顺序，甚至在`hasHandlers()`方法里面都有明显的错误，`Event`的实现大概就是这样，它包含了通用的静态方法和静态属性，来执行和保存全局，同时也包含私有属性，来规范并传递参数

#### Component
`Event`类继承的是基类`BaseObject`，貌似看着跟框架主体没有一点联系啊，那是因为`Event`默认是类级别的事件，正确的使用方式是你自己对你的业务涉及一些事件类，这些类都继承自`Event`，每个自定义事件类有自己独特的属性，这样就可以区分不同种类的事件了，那框架主体怎么使用事件机制的呢，这里就需要看看`Component`类了，`Component`实现的是全局级别的事件，会贯穿整个生命周期
```php
// Component中对应处理事件的几个方法

// 绑定全局事件handler
// 既然是全局的，就需要传class了咯
public function on($name, $handler, $data = null, $append = true)
    {
        // 这个先别管，行为范畴，后面会讲
        $this->ensureBehaviors();

        // 同样区分匹配模式
        // 大致行为跟Event类差不多，只是保存handler的数组里少了class这一维度，并且保存handler的数组不再是static，而是private，因为我们通过入口创建的Application实例会继承到Component，所以属于单个实例私有的数据
        if (strpos($name, '*') !== false) {  
            if ($append || empty($this->_eventWildcards[$name])) {
                $this->_eventWildcards[$name][] = [$handler, $data];
            } else {
                array_unshift($this->_eventWildcards[$name], [$handler, $data]);
            }
            return;
        }

        if ($append || empty($this->_events[$name])) {
            $this->_events[$name][] = [$handler, $data];
        } else {
            array_unshift($this->_events[$name], [$handler, $data]);
        }
    }

    // 解除全局事件绑定
    public function off($name, $handler = null)
    {
        $this->ensureBehaviors();
        // 没有绑定过，解除个毛线
        if (empty($this->_events[$name]) && empty($this->_eventWildcards[$name])) {
            return false;
        }
        // 未指定handler，全解除
        if ($handler === null) {
            unset($this->_events[$name], $this->_eventWildcards[$name]);
            return true;
        }

        $removed = false;
        // plain event names
        if (isset($this->_events[$name])) {
            // 指定handler，逻辑与Event类中的off一样
            foreach ($this->_events[$name] as $i => $event) {
                if ($event[0] === $handler) {
                    unset($this->_events[$name][$i]);
                    $removed = true;
                }
            }
            if ($removed) {
                $this->_events[$name] = array_values($this->_events[$name]);
                return $removed;
            }
        }

        // 通配符模式，逻辑与Event类中的off一样
        if (isset($this->_eventWildcards[$name])) {
            foreach ($this->_eventWildcards[$name] as $i => $event) {
                if ($event[0] === $handler) {
                    unset($this->_eventWildcards[$name][$i]);
                    $removed = true;
                }
            }
            if ($removed) {
                $this->_eventWildcards[$name] = array_values($this->_eventWildcards[$name]);
                // remove empty wildcards to save future redundant regex checks:
                if (empty($this->_eventWildcards[$name])) {
                    unset($this->_eventWildcards[$name]);
                }
            }
        }

        return $removed;
    }

    // 触发执行事件绑定的handler
    public function trigger($name, Event $event = null)
    {
        $this->ensureBehaviors();

        $eventHandlers = [];
        // 没有类这一层级了，就不需要循环调用了，直接收集所有符合的handler
        foreach ($this->_eventWildcards as $wildcard => $handlers) {
            if (StringHelper::matchWildcard($wildcard, $name)) {
                $eventHandlers = array_merge($eventHandlers, $handlers);
            }
        }

        if (!empty($this->_events[$name])) {
            // 这里和Event类差不多
            // 除了在设置sender上面，这里把this赋值给sender，表示当前实例
            $eventHandlers = array_merge($eventHandlers, $this->_events[$name]);
        }

        if (!empty($eventHandlers)) {
            if ($event === null) {
                $event = new Event();
            }
            if ($event->sender === null) {
                $event->sender = $this;
            }
            $event->handled = false;
            $event->name = $name;
            foreach ($eventHandlers as $handler) {
                $event->data = $handler[1];
                call_user_func($handler[0], $event);
                // stop further handling if the event is handled
                if ($event->handled) {
                    return;
                }
            }
        }

        // 这里还会触发类级别的事件handler
        Event::trigger($this, $name, $event);
    }
```
上面就是`Component`中实现的全局事件机制，只跟当前`Application`实例绑定，而`Application`通过注册`Yii::$app`来实现全局可访问，这样整个生命周期都可以执行全局事件的绑定、解绑和触发执行机制
