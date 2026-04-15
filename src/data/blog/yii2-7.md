---
title: "Yii2框架源码分析系列--行为"
author: "Joker"
pubDatetime: 2017-04-06T17:22:00+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "Yii2框架行为源码详细解析"
---

#### 回顾
上一篇聊了下yii2的事件`Event`，今天来介绍下与事件紧密联系的行为`Behavior`

#### Behavior
行为可以向你的类中注入新的成员变量和成员方法，让你的类变得更加的灵活，所有要使用行为的类都必须继承`Component`

#### 举个栗子
```php
// 创建一个自己的行为类
class MyBehavior extends Behavior
{
    public $name;
    public function getName() {
        return $this->name;
    }
    public function setName($name) {
        $this->name = $name;
    }
}

// 创建一个空的继承自Component的类
class MyClass extends Component
{
}

// Controller中实现对MyClass绑定行为MyBehavior
class MyController extends Controller
{
    public function actionIndex() {
        $myBehavior = new MyBehavior();
        $myClass = new MyClass();
        // 绑定MyBehavior
        $myClass->attachBehavior('myBehavior', $myBehavior);
        // 绑定后可以使用MyBehavior中定义的setName和getName方法
        $myClass->setName('joker');
        exit($myClass->getName());  // 输出joker
    }
}
```
#### Behavior类
大致了解了如何使用行为，下面来看下Yii2中`Behavior`的实现
```php
class Behavior extends BaseObject
{
    // 保存绑定到该行为的对象实例
    public $owner;

    // 与本行为绑定的事件
    public function events()
    {
        return [];
    }
    
    // 绑定行为
    public function attach($owner)
    {
        // 绑定到哪个类
        $this->owner = $owner;
       // 将本行为中包含的事件绑定到$owner中
       // 这里事件的绑定可以看前面的系列(6)
        foreach ($this->events() as $event => $handler) {
            $owner->on($event, is_string($handler) ? [$this, $handler] : $handler);
        }
    }

    // 解绑行为
    public function detach()
    {
        if ($this->owner) {
            // 首先解绑事件
            foreach ($this->events() as $event => $handler) {
                $this->owner->off($event, is_string($handler) ? [$this, $handler] : $handler);
            }
            // 不再绑定到任何类
            $this->owner = null;
        }
    }
}
```
`Behavior`的实现比`Event`简单多了，无非就是通过`$owner`来标志绑定到哪个类，同时我们继承`Behavior`类来定义自己的行为类时，可以通过重载`events()`方法来定义一些事件，每次绑定行为的时候也会将事件绑定上去，从而使得行为与事件联系起来

#### attachBehavior
再回到之前的栗子，`MyClass`通过`attachBehavior()`方法来绑定行为，该方法由`Component`类来提供，这也解释了为什么类必须继承`Component`才可以绑定行为，下面看下具体的实现
```php
public function attachBehavior($name, $behavior)
    {
        // 确保绑定了behaviors()中自定义的行为
        $this->ensureBehaviors();
        // 实际干活的方法是attachBehaviorInternal()
        return $this->attachBehaviorInternal($name, $behavior);
    }
```
这个`ensureBehaviors()`是什么鬼，如果你细心看下`Component`类的代码会发现，`ensureBehaviors()`出现在很多地方，不厌其烦，来看看这货是干嘛滴
```php
public function ensureBehaviors()
    {
        // _behaviors保存了绑定到该类的所有行为
        // 因为该方法频繁调用，这里将_behaviors作为哨兵，加快速度
        if ($this->_behaviors === null) {
            $this->_behaviors = [];
            // 绑定behaviors()方法中配置的行为
            foreach ($this->behaviors() as $name => $behavior) {
                $this->attachBehaviorInternal($name, $behavior);
            }
        }
    }
```
这个`ensureBehaviors()`就是为了确保`behaviors()`中配置的行为都执行了绑定，而`Component`中`behaviors()`返回的是空数组，这个玩意吧，是在你创建自己的类的时候通过重载，写入自定义的行为配置，这样，`Component`会优先把这些行为绑定到你创建的类，注意，是优先，所以很多地方都会埋这个方法来做一遍检查，接下来看看实际执行绑定的方法`attachBehaviorInternal()`
```php
private function attachBehaviorInternal($name, $behavior)
    {
        // 不是Behavior的实例
        // 传递的可能是类名，创建实例
        // 例如之前的栗子可以改成这样：
        // $myClass->attachBehavior('myBehavior', 'app\library\MyBehavior');
        if (!($behavior instanceof Behavior)) {
            // createObject之前介绍过了，至于能接受哪些格式的参数，自己翻翻前面
            $behavior = Yii::createObject($behavior);
        }
        // $name是整数，直接绑定
        if (is_int($name)) {
            // 调用了Behavior的attach，传递$this，这样$owner=$this就实现了绑定
            $behavior->attach($this);
            // 匿名保存绑定的行为
            $this->_behaviors[] = $behavior;
        } else {
            // 指定了$name
            // 先解绑已绑定的同名行为再绑定当前类
            if (isset($this->_behaviors[$name])) {
                $this->_behaviors[$name]->detach();
            }
            $behavior->attach($this);
            // 保存行为名与行为的映射
            $this->_behaviors[$name] = $behavior;
        }
        return $behavior;
    }
```
简单吧，挺简单的，过

#### 如何注入变量和方法的
绑是绑完了，但是绑完就可以让我的类访问行为的变量和方法了，这是怎么做到的，这里我们先看下怎么访问行为的方法的，记得`Component`有一些魔术方法吧，看下`__call`
```php
public function __call($name, $params)
    {
        // 又是这货
       // 确保所有行为都已绑定
        $this->ensureBehaviors();
        // 遍历已绑定行为
        foreach ($this->_behaviors as $object) {
            // 判断行为类中是否有$name方法
            // hasMethod实现很简单，自己看下
            if ($object->hasMethod($name)) {
                return call_user_func_array([$object, $name], $params);
            }
        }

        // 所有行为都没有包含调用的方法，异常
        throw new UnknownMethodException('Calling unknown method: ' . get_class($this) . "::$name()");
    }
```
再看下`__get`
```php
public function __get($name)
    {
        // 先判断是否已经实现了相应的get方法
        $getter = 'get' . $name;
        if (method_exists($this, $getter)) {
            // read property, e.g. getName()
            return $this->$getter();
        }

        // 无处不在
        $this->ensureBehaviors();
        // 遍历已绑定行为
        foreach ($this->_behaviors as $behavior) {
            // 判断行为类中是否有对应的getter方法或者对应的成员变量
            // canGetProperty自己看下，简单略
            if ($behavior->canGetProperty($name)) {
                return $behavior->$name;
            }
        }

        // 有set没get，只读异常
        if (method_exists($this, 'set' . $name)) {
            throw new InvalidCallException('Getting write-only property: ' . get_class($this) . '::' . $name);
        }

        // 其他异常
        throw new UnknownPropertyException('Getting unknown property: ' . get_class($this) . '::' . $name);
    }
```
大致就是这样，通过魔术方法，确保行为已绑定，遍历行为，只要找到对应的方法或者变量，立马结束，所以如果你绑定了多个行为，然后有相同的方法名或变量名，可要小心点

#### 解除绑定
通过detachBehavior()方法来解除绑定
```php
public function detachBehavior($name)
    {
        // 惹不起，惹不起
        $this->ensureBehaviors();
        // 只能解绑设定了名字的行为
        // 如果是匿名的，你根本不知道它在_behaviors中的数字索引
        // 不过你可以通过detachBehaviors来把所有行为全部解绑，这里不介绍了
        if (isset($this->_behaviors[$name])) {
            $behavior = $this->_behaviors[$name];
            // 从_behaviors中删除
            unset($this->_behaviors[$name]);
            // 行为解绑
            $behavior->detach();
            return $behavior;
        }
        return null;
    }
```
#### 总结
行为跟PHP的trait挺类似的，但是更加灵活一点，当然也更慢点，比如魔术方法里面的暴力循环遍历行为，无处不在的`ensureBehaviors()`等，行为可以随时绑定，也可以随时解绑，可以通过`behaviors()`方法来配置自定义，也可以显示的通过`attachBehavior()`来绑定
