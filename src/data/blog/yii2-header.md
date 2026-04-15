---
title: "Yii2基于header实现版本控制"
author: "Joker"
pubDatetime: 2017-04-15T15:01:38+08:00
draft: false
tags:
  - "PHP"
  - "Yii2"
description: "扩张Yii2原生的版本控制方案，基于header实现"
---

Yii2官方给出的方案是基于url的版本控制，但是我们的versoin放在header里面，需要通过header来进行版本控制，实现如下
 - 首先在基类中实现`actions`，`actions`是针对`controller`的`action`扩展，看源码可以知道，在`createAction`中会先检查`actionMap`，而`actionMap=actions()`，也就是说`actions`里面的配置优先于`controller`的`inline actions`，这样我们就可以通过检查版本跳到对应的扩展`action`，然后通过配置参数再次跳到当前`controller`的其他内部`action`

基类actions实现
```php
public function actions()
{
    $parent = parent::actions();
    $actions = (new Version())->convertActionMap();
    return array_merge($parent, $actions);
}
```

Version类的实现
```php
class Version extends Object
{
    // 根据自己的header版本标识相应改动
    public $versionParam = "Appver";
    public $actionMap = null;
    // 外部扩展action接口，可以放到配置中去
    public $class = 'frontend\models\VersionControl';

    public function getVersion()
    {
        return Yii::$app->getRequest()->getHeaders()->get($this->versionParam);
    }

    public function getActionMap()
    {
        if ($this->actionMap === null) {
            $version = $this->getVersion();
            $now = '';
            $action_map = [];
            $version_map = Yii::$app->params['version_map'] ?? [];
            foreach ($version_map as $v => $map) {
                if ($version >= $v) {
                    if ($v >= $now) {
                        $action_map = ArrayHelper::merge($map, $action_map);
                    } else {
                        $action_map = ArrayHelper::merge($action_map, $map);
                    }
                    $now = $v;
                }
            }
            $controller = Yii::$app->controller->id;
            $this->actionMap = $action_map[$controller] ?? [];
        }

        return $this->actionMap;
    }

    public function convertActionMap() {
        $action_map = $this->getActionMap();
        foreach ($action_map as $key => $map) {
            $action_map[$key] = [
                'class' => $this->class,
                'action' => $map,
            ];
        }

        return $action_map;
    }
}
```

VersionControl的实现
```php
class VersionControl extends Action
{
    public $action;

    public function run()
    {
        // 只是一层跳转从端上访问的action跳到别的action
        return $this->controller->runAction($this->action);
    }
}
```

Params的配置
```php
'version_map' => [
        '1.1.1' => [  // 版本
            'login' => [  // 控制器id
                'index' => 'index1',  // 旧action => 新action
            ],
        ],
    ],
```