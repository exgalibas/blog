---
title: "mac fswatch+rsync实时同步远程文件"
author: "Joker"
pubDatetime: 2015-12-10T10:55:18+08:00
draft: false
tags:
  - "tool"
description: "mac实现本地文件实时监听变更并同步到远程服务器"
---

#### 前言
对于远程实时同步文件，linux上有inotify+rsync，mac上可以用fswatch+rsync

#### 安装fswatch
mac上通过包管理器brew使用`brew install fswatch`安装fswatch(没有brew的自行去安装brew)，有可能下载不下来fswatch，因为brew默认访问的https，对于这种情况，可以先`brew --cache` (没有装xcode的还是装下吧) 找到brew的包下载缓存路径`/Library/Caches/Homebrew `，
然后根据`brew install fswatch`命令中输出的 现在路径 自己去浏览器下载，修改https为http，下载下来是个tar.gz的包。把下载下来的fswatch复制到`/Library/Caches/Homebrew`中，注意要保持文件名与之前`brew install fswatch`中输出的文件名一致，否则`brew install`找不到缓存包又会去下载，然后死循环

#### 脚本
mac自带了rsync工具，我们可以直接使用，同时可以通过脚本控制后台运行，实时监控，我的脚本如下，仅供参考
```shell
#!/bin/zsh
fswatch /Users/joker/joker/ | while read file
do
rsync -rltzuq --delete --exclude='.*' /Users/joker/joker/ 10.13.130.70::mmm/
echo "${file} was rsynced" >> /usr/local/var/log/rsync.log 2>&1
done
```
我的shell是zsh，如果是用的bash可以改成bash，后面的echo语句是记录日志用的。这里有一个需要注意的地方，确定fswatch 和 rsync命令所在的文件夹 在你shell的配置文件中，我的在~/.zshrc里面`export PATH=/usr/local/bin:/usr/local/sbin:$HOME/bin:/usr/local/bin:$PATH`

#### rsync配置
`/User/joker/joker/`是我需要同步的本地文件，`10.13.130.70`是我的远程机器`mmm`是我远程机器(linux操作系统)上`/etc/rsync.conf`里面定义的模块，贴上rsync.conf的配置
```conf
uid = root
gid = root
use chroot = no
max connections = 10
strict modes = yes
log file = /data1/v5.weibo.cn/logs/rsyncd/rsync.log
pid file = /var/run/rsync.pid
[mmm]
path = /data1/joker/code/
comment = analyse
read only = false
hosts allow = *
```
看到里面的`mmm`模块没，`path`里面的路径就是需要同步的远程机器中的文件夹，我的`host allow = *` 表示所有机器都可以访问，如果需要安全点的话就设置`host deny = *`，然后在`host deny`上面另写一行 `host allow = 你允许的远程ip`

#### 运行
后台运行该脚本，或者直接设置开机后台启动即可，脚本会一直监视对应文件是否更改，只要更改就会使用rsync进行远程实时同步