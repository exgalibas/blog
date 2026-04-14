---
title: "记一次shell分享"
author: "Joker"
pubDatetime: 2016-11-20T11:21:24+08:00
draft: false
tags:
  - "shell"
description: "分享一些shell使用小技巧"
---

## 原理
shell用fork建⽴新进程，⽤execv函数簇在新进程中运⾏⽤户指定的程序，然后shell⽤wait命令等待新进程结束。
wait系统调⽤同时从内核取得退出状态或者信号序号以告知⼦进程是如何结束的。

## 开胃

* sudo !!
* !old
* \^old\^new
* \>filename
* man ascii
* getconf LONG_BIT
* man hier

## 基础
### 文件及目录
cd -
: 路径快切

pwd
: 当前全路径

tree
: 目录树状图
：-L 递归层数

file
: 辨识文件类型

diff
: 比较两个文件的所有差异
: -y 并列方式展示
: -W 指定列宽
: -i 忽略大小写
: -q 仅显示有无差异,不显示详细的信息

### 搜索
which
: 在环境变量$PATH查找符合条件的文档

locate
: 从数据库中查找符合条件的文档
: 模糊查
: /var/lib/mlocate

find
: 在指定目录下查找文件
: -name 指定文件名
: -atime 在过去n天内被读取过的文件
: -ctime 在过去n天内被修改过的文件
: -cmin 在过去 n 分钟内被修改过

### 查看
more,less
: 翻页查看文件
: less -m 显示百分比
: less非全加载，且支持前后向搜索

head,tail
: -n 显示头或尾多少行
: tail -f 动态实时监控显示

### 统计
wc 
: -l 行数
: -c 字节数
: -w 字数

### 切分与合并
split
: 将一个文件分割成数个
: -l 按照n行进行切割
: -b 按照字节进行切割

### 任务调度
bg,fg,jobs
: jobs 查看当前有多少在后台运行的命令
: bg num 执行在后台暂停的任务
: fg num 将后台任务搬到前台运行

### 磁盘管理
df
: -h 个性化显示

du
: -h 同上
: -s 不递归整个目录
: 查找大文件 `du -s /etc/* | sort -nr | head -5`

### 进程管理
lsof
: 查看当前系统文件(一切皆文件)
: lsof filename 打开某文件的进程
: -c 列出某个程序进程打开的文件信息
: -u username 某个用户打开的文件信息
: -p pid 某个进程打开的文件信息
: -i:port 谁在使用某个端口

killall
: killall name 杀死相关的所有进程

pstack
: 跟踪进程栈

strace
: 跟踪进程执行时的系统调用和所接收的信号
: -T 显示每个调用所消耗的时间
: -e trace=open,close,write...
### 系统管理
top
: 最常用的监控工具
: -c 显示完整的命令
: M 根据驻留内存大小进行排序。
: P 根据CPU使用百分比大小进行排序。
: T 根据时间/累计时间进行排序。

free
: 显示内存状态

netstat
: 最常用的网络状态查看工具
: -anp 列出所有端口

### 文本处理工具
#### Sed
Sed Strem Editor(流编辑器)缩写，是操作、过滤和转换文本内容的强大工具。常用功能有增删改查，过滤，取行。

##### 语法格式
sed [options] [sed-commands] [input-file]
sed [选项]     [sed命令]      [输入文件]

##### 常用选项
-f 选项 使用命令文件
-n 选项 禁止输出
-i 选项 修改落地到磁盘

##### 常用命令
a 行后增加一行
i 行前增加一行
d 删除行
c 行替换
s 文本段替换
p 打印

##### 增
```shell
sed '2a\第二行后面增加一行' test
sed '2i\第二行前面增加一行' test
```

##### 指定执行地址范围
sed软件可以对单行或多行进行处理。如果在sed命令前面不指定地址范围，那么默认会匹配所有行。
用法：n1[,n2]{sed-commands}
地址用逗号分隔的，n1,n2可以用数字、正则表达式、或二者的组合表示。
例子：
```shell
     10{sed-commands}        对第10行操作
　　　10,20{sed-commands}     对10到20行操作,包括第10,20行
　　　10,\${sed-commands}     对10到最后一行(\$代表最后一行)操作
     /a/{sed-commands}       对匹配a的行操作
     /a/,/b/{sed-commands}    对匹配a的行到匹配b的行操作
     /a/,+2{sed-commands}      对匹配oldboy的行到其后的2行操作
```

##### 删
```shell
sed 'd' test  //全删
sed '2d' test  //指定删除第二行
sed '2,5d' test //区间删
sed '/partern/d' test //模式匹配删
sed '/a/,/b/d' test //模式匹配区间删
```
##### 改
```shell
sed '2c 替换第二行' test
sed 's#zhangyao#oldboyedu#2' test //只替换第二处
sed 's#zhangyao#oldboyedu#g' test //全替换
sed '1,3s#C#--&--#g' test  //&代表被替换内容，此处为C
```

##### 查
```shell
sed -n '2p' test //输出第二行
sed -n '/joker/p' test //输出包含joker的所有行
```

##### 举个栗子
```shell
sed -n 'N; /hello\nworld/p' test
```

#### Awk
awk是一种编程语言，用于在linux/unix下对文本和数据进行处理

##### 功能
* 定义变量保存数据
* 使用算数运算和字符串操作符来处理数据
* 使用结构化编程概念(if-then)来为数据处理增加逻辑
* 通过提取数据文件中的数据元素，将其重新排列和格式化

##### 语法格式
gawk [options] [program] [file]
gawk  [选项]     [程序]    [文件]

##### 常用选项
-f 执行脚本
-F 指定字段分隔符
-v 设定变量

##### 直接看代码吧
```shell
awk 'BEGIN {print "hello joker"} {print $0,$1} END {print "bye joker"}'  // 先行、尾行和内建变量

awk 'BEGIN{x=4;x=x*2;print x}'  // 自定义变量和算数运算

awk '/^hello/{print $2}'  // 正则匹配 !禁止正则

awk -F: '{if ($4 == 0) print $1}' /etc/passwd  // 算数运算 结构化 组ID为0的用户

awk '{x = 5; printf "%d\n", x}'  //格式化输出
```

##### 一些栗子
```shell
awk 'BEGIN{count=0} {count++} END{print count}' /etc/passwd // 实现wc -l
awk '/^nobody/{print $0}' /etc/passwd  // 找nobody的用户信息
ls -l | awk '{if($5>1000) print $9}'   // 列出文件大小 >1000的文件名
ps -ef | awk '/^nginx/{print $0}'  // ps -ef | grep nginx
```

### 推荐
nc
[一个很酷的网站](https://cmdchallenge.com)
[另外一个很酷网站](https://www.commandlinefu.com)

## 附录

### 开胃
sudo !!
: root身份执行上一条命令

!old
: 执行上一条old命令

^old^new
: 替换前一条命令里的部分字符串

\>filename
: touch filename

man ascii
: 显示ascii码表

getconf LONG_BIT
: 查看机器位数

man hier
: 展示系统目录结构