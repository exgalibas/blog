---
title: "k8s搭建xxl-job环境"
author: "Joker"
pubDatetime: 2022-07-11T11:51:18+08:00
draft: false
tags:
  - "k8s"
  - "xxl-job"
description: "使用k8s搭建xxl-job环境探索"
---

## 背景
搭建本地k8s环境和xxl-job测试环境，在k8s环境中跑通xxl-job调度器和执行器

## 搭建k8s
注：本次搭建仅针对mac
### 安装docker&k8s
[下载docker](https://www.docker.com/products/docker-desktop/)，注意区分intel芯和apple芯(M芯)，如下图 
![01.png](/images/k8s-xxl/01.png)
安装完成后，新版的docker都会自带k8s，直接在右上角设置->preferences中勾选启用即可，如下图
![02.png](/images/k8s-xxl/02.png)
勾选后点击apply&restart，docker就会去下载所需的镜像，我们公司网络自带翻墙，所以下载速度还挺快，如果是墙内，可以自行拉取阿里云的镜像源，具体方法如下：
1. 拉取git仓库
```shell
git clone https://github.com/AliyunContainerService/k8s-for-docker-desktop.git
```
2. 匹配版本，先查看k8s的版本号，Docker Desktop→about，如下：
![03.png](/images/k8s-xxl/03.png)
在远程k8s-for-docker-desktop仓库中找到对应的tag，如v1.14.8就对应1.14.8版本的k8s，同时本地切到对应版本的branch，如果没有找到对应的tag就使用默认master分支，执行脚本bash load_images.sh，等待所有的镜像下载完毕后就可以去docker开启k8s了

### 验证k8s
查看集群状态：
![04.png](/images/k8s-xxl/04.png)
查看节点：
![05.png](/images/k8s-xxl/05.png)
如果都显示正常，说明k8s已经安装成功(这里可以设置下alias kb=kubectl)

### 安装dashboard
k8s有一个dashboard界面工具，可以对k8s进行可视化管理，命令党可忽略
执行如下命令
```shell
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.5.0/aio/deploy/recommended.yaml
```
该命令会创建dashboard的pod，以及对应的serviceaccount，如下：
![06.png](/images/k8s-xxl/06.png)
至此dashboard就安装完毕了，继续执行命令启用dashboard
```shell
kubectl proxy
// Starting to serve on 127.0.0.1:8001
```
默认是监听8001端口，浏览器访问[http://](http://localhost:8001/)[localhost:8001/](http://localhost:8001/api/v1/namespaces/kubernetes-dashboard/services/https:kubernetes-dashboard:/proxy/)可以查看k8s的接口列表，访问[http://localhost:8001/api/v1/namespaces/kubernetes-dashboard/services/https:kubernetes-dashboard:/proxy/](http://localhost:8001/api/v1/namespaces/kubernetes-dashboard/services/https:kubernetes-dashboard:/proxy/)，如下：
![07.png](/images/k8s-xxl/07.png)
这里需要一个token，可以针对kubernetes-dashboard空间的admin-user来生成一个，执行命令
```shell
kubectl -n kubernetes-dashboard create token admin-user
//eyJhbGciOiJSUzI1NiIsImtpZCI6IjZmUi1BRTlZOXVhLWJUcGtrUlhVTUU1WUhLSVZDQml0dW9JQ29FdV9VcEUifQ.eyJhdWQiOlsiaHR0cHM6Ly9rdWJlcm5ldGVzLmRlZmF1bHQuc3ZjLmNsdXN0ZXIubG9jYWwiXSwiZXhwIjoxNjU0NjU5NTk5LCJpYXQiOjE2NTQ2NTU5OTksImlzcyI6Imh0dHBzOi8va3ViZXJuZXRlcy5kZWZhdWx0LnN2Yy5jbHVzdGVyLmxvY2FsIiwia3ViZXJuZXRlcy5pbyI6eyJuYW1lc3BhY2UiOiJrdWJlcm5ldGVzLWRhc2hib2FyZCIsInNlcnZpY2VhY2NvdW50Ijp7Im5hbWUiOiJhZG1pbi11c2VyIiwidWlkIjoiYzE2YjQ1ZjgtMzM4Ny00NzI4LTlhM2MtNTE0ZTNmODJhOWYwIn19LCJuYmYiOjE2NTQ2NTU5OTksInN1YiI6InN5c3RlbTpzZXJ2aWNlYWNjb3VudDprdWJlcm5ldGVzLWRhc2hib2FyZDphZG1pbi11c2VyIn0.pn9jPBN-A8LaRtJHyW4fqYt8d6955l86DonOfkWjZ6nhfeHSjqbeqjac-uWcctax-OPyRHo8ezctgNNtpN_lwnbI_ZRBH3holMhPy601cov2XkGVKjLfyS02t-WL3CalvlRJ375HUzWXvkPTKnNo_ZGhljtnojNN8Yvxiad3u_OftDSs19kYCQJqp-tIB35m1CWruu51BoD7p-rIr2DnCZb7DLOY4a6NGKE_I5Z3MA_-Y4rOWtLCnq1o-GnkQLNqNt3cxWnEPr2kMrviivro0JxdYFWa4tFlsc7TpnR7S-QZu4Do0yKn7l5K3U7PE3qlTbfB1zOp5cm9qO3bl2ORGQ
```
生成一个临时的token，至此就可以登陆到dashboard中了，界面如下：
![08.png](/images/k8s-xxl/08.png)
## 搭建xxl-job
xxl-job依赖mysql，需要先安装mysql，再安装xxl-job，同时需要注意本机分别要与mysql-pod和xxl-job-pod进行通信，本次安装mysql使用端口映射方式，xxl-job使用nodeport方式

### 搭建mysql
因为mysql是有状态的pod，即存储的数据我们希望在pod销毁后还留存在节点中(即本机)，所以需要构造持久卷，如下是持久卷和mysql对应的yaml
**mysql-pv.yaml**
```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: mysql-pv-volume
  labels:
    type: local
spec:
  storageClassName: manual
  capacity:
    storage: 20Gi
  accessModes:
    - ReadWriteOnce
  hostPath:
    path: "/mnt/data"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-pv-claim
spec:
  storageClassName: manual
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```
**mysql-deployment.yaml**
```yaml
apiVersion: v1
# 这里构建了一个service，后续k8s内部通信可以通过服务名mysql来寻找到对应的pod
kind: Service
metadata:
  name: mysql
spec:
  ports:
  - port: 3306
  selector:
    app: mysql
  clusterIP: None
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql
spec:
  selector:
    matchLabels:
      app: mysql
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
	  # 这里的镜像可以通过docker hub查看对应的mysql镜像tag，因为我的机器的os/arch是linux/arm64/v8，所以使用mysql:oracle，可自行根据实际选择
      # 可以通过docker pull拉取是否成功来验证镜像是否ok，如果拉取不成功，pod将无法创建
      - image: mysql:oracle
        name: mysql
        env:
		  # 这里手动设置了mysql的密码是password，方便测试
        - name: MYSQL_ROOT_PASSWORD
          value: password
        ports:
        - containerPort: 3306
          name: mysql
        volumeMounts:
        - name: mysql-persistent-storage
          mountPath: /var/lib/mysql
      volumes:
      - name: mysql-persistent-storage
        persistentVolumeClaim:
          claimName: mysql-pv-claim
```
执行命令
```shell
kubectl apply -f mysql-pv.yaml
kubectl apply -f mysql-deployment.yaml
```
查看svc、pvc、deployment和pod是否创建成功，如下：
![09.png](/images/k8s-xxl/09.png)
也可以通过创建一个client的pod来连接到mysql服务，验证安装是否成功，执行命令
```shell
kubectl run -it --rm --image=mysql:oracle --restart=Never mysql-client -- mysql -h mysql -ppassword
// k8s内部pod之间通信可以通过服务名mysql代替host
```
如果安装成功，可以看到mysql>标识符(可能需要点击enter触发，具体看交互文案)，如下：
![10.png](/images/k8s-xxl/10.png)
至此mysql已经成功部署到k8s，现在通过端口映射来支持k8s外部本机操作mysql，方便curd，执行命令将mysql service的3306端口映射到本机的3306端口
```shell
kubectl port-forward service/mysql 3306:3306
```
本机连接，这里推荐一个工具[tableplus](https://www.macwk.com/soft/tableplus)，如下(密码是之前设置的password)：
![11.png](/images/k8s-xxl/11.png)
执行xxl-job-sql，git地址[https://github.com/xuxueli/xxl-job/blob/2.3.1/doc/db/tables_xxl_job.sql](https://github.com/xuxueli/xxl-job/blob/2.3.1/doc/db/tables_xxl_job.sql)，我们选择最新版本v2.3.1，待会部署同样版本的xxl-job，sql如下：
```sql
CREATE database if NOT EXISTS `xxl_job` default character set utf8mb4 collate utf8mb4_unicode_ci;
use `xxl_job`;

SET NAMES utf8mb4;

CREATE TABLE `xxl_job_info` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_group` int(11) NOT NULL COMMENT '执行器主键ID',
  `job_desc` varchar(255) NOT NULL,
  `add_time` datetime DEFAULT NULL,
  `update_time` datetime DEFAULT NULL,
  `author` varchar(64) DEFAULT NULL COMMENT '作者',
  `alarm_email` varchar(255) DEFAULT NULL COMMENT '报警邮件',
  `schedule_type` varchar(50) NOT NULL DEFAULT 'NONE' COMMENT '调度类型',
  `schedule_conf` varchar(128) DEFAULT NULL COMMENT '调度配置，值含义取决于调度类型',
  `misfire_strategy` varchar(50) NOT NULL DEFAULT 'DO_NOTHING' COMMENT '调度过期策略',
  `executor_route_strategy` varchar(50) DEFAULT NULL COMMENT '执行器路由策略',
  `executor_handler` varchar(255) DEFAULT NULL COMMENT '执行器任务handler',
  `executor_param` varchar(512) DEFAULT NULL COMMENT '执行器任务参数',
  `executor_block_strategy` varchar(50) DEFAULT NULL COMMENT '阻塞处理策略',
  `executor_timeout` int(11) NOT NULL DEFAULT '0' COMMENT '任务执行超时时间，单位秒',
  `executor_fail_retry_count` int(11) NOT NULL DEFAULT '0' COMMENT '失败重试次数',
  `glue_type` varchar(50) NOT NULL COMMENT 'GLUE类型',
  `glue_source` mediumtext COMMENT 'GLUE源代码',
  `glue_remark` varchar(128) DEFAULT NULL COMMENT 'GLUE备注',
  `glue_updatetime` datetime DEFAULT NULL COMMENT 'GLUE更新时间',
  `child_jobid` varchar(255) DEFAULT NULL COMMENT '子任务ID，多个逗号分隔',
  `trigger_status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '调度状态：0-停止，1-运行',
  `trigger_last_time` bigint(13) NOT NULL DEFAULT '0' COMMENT '上次调度时间',
  `trigger_next_time` bigint(13) NOT NULL DEFAULT '0' COMMENT '下次调度时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `xxl_job_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `job_group` int(11) NOT NULL COMMENT '执行器主键ID',
  `job_id` int(11) NOT NULL COMMENT '任务，主键ID',
  `executor_address` varchar(255) DEFAULT NULL COMMENT '执行器地址，本次执行的地址',
  `executor_handler` varchar(255) DEFAULT NULL COMMENT '执行器任务handler',
  `executor_param` varchar(512) DEFAULT NULL COMMENT '执行器任务参数',
  `executor_sharding_param` varchar(20) DEFAULT NULL COMMENT '执行器任务分片参数，格式如 1/2',
  `executor_fail_retry_count` int(11) NOT NULL DEFAULT '0' COMMENT '失败重试次数',
  `trigger_time` datetime DEFAULT NULL COMMENT '调度-时间',
  `trigger_code` int(11) NOT NULL COMMENT '调度-结果',
  `trigger_msg` text COMMENT '调度-日志',
  `handle_time` datetime DEFAULT NULL COMMENT '执行-时间',
  `handle_code` int(11) NOT NULL COMMENT '执行-状态',
  `handle_msg` text COMMENT '执行-日志',
  `alarm_status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '告警状态：0-默认、1-无需告警、2-告警成功、3-告警失败',
  PRIMARY KEY (`id`),
  KEY `I_trigger_time` (`trigger_time`),
  KEY `I_handle_code` (`handle_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `xxl_job_log_report` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `trigger_day` datetime DEFAULT NULL COMMENT '调度-时间',
  `running_count` int(11) NOT NULL DEFAULT '0' COMMENT '运行中-日志数量',
  `suc_count` int(11) NOT NULL DEFAULT '0' COMMENT '执行成功-日志数量',
  `fail_count` int(11) NOT NULL DEFAULT '0' COMMENT '执行失败-日志数量',
  `update_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_trigger_day` (`trigger_day`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `xxl_job_logglue` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_id` int(11) NOT NULL COMMENT '任务，主键ID',
  `glue_type` varchar(50) DEFAULT NULL COMMENT 'GLUE类型',
  `glue_source` mediumtext COMMENT 'GLUE源代码',
  `glue_remark` varchar(128) NOT NULL COMMENT 'GLUE备注',
  `add_time` datetime DEFAULT NULL,
  `update_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `xxl_job_registry` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `registry_group` varchar(50) NOT NULL,
  `registry_key` varchar(255) NOT NULL,
  `registry_value` varchar(255) NOT NULL,
  `update_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `i_g_k_v` (`registry_group`,`registry_key`,`registry_value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `xxl_job_group` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `app_name` varchar(64) NOT NULL COMMENT '执行器AppName',
  `title` varchar(12) NOT NULL COMMENT '执行器名称',
  `address_type` tinyint(4) NOT NULL DEFAULT '0' COMMENT '执行器地址类型：0=自动注册、1=手动录入',
  `address_list` text COMMENT '执行器地址列表，多地址逗号分隔',
  `update_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `xxl_job_user` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL COMMENT '账号',
  `password` varchar(50) NOT NULL COMMENT '密码',
  `role` tinyint(4) NOT NULL COMMENT '角色：0-普通用户、1-管理员',
  `permission` varchar(255) DEFAULT NULL COMMENT '权限：执行器ID列表，多个逗号分割',
  PRIMARY KEY (`id`),
  UNIQUE KEY `i_username` (`username`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `xxl_job_lock` (
  `lock_name` varchar(50) NOT NULL COMMENT '锁名称',
  PRIMARY KEY (`lock_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `xxl_job_group`(`id`, `app_name`, `title`, `address_type`, `address_list`, `update_time`) VALUES (1, 'xxl-job-executor-sample', '示例执行器', 0, NULL, '2018-11-03 22:21:31' );
INSERT INTO `xxl_job_info`(`id`, `job_group`, `job_desc`, `add_time`, `update_time`, `author`, `alarm_email`, `schedule_type`, `schedule_conf`, `misfire_strategy`, `executor_route_strategy`, `executor_handler`, `executor_param`, `executor_block_strategy`, `executor_timeout`, `executor_fail_retry_count`, `glue_type`, `glue_source`, `glue_remark`, `glue_updatetime`, `child_jobid`) VALUES (1, 1, '测试任务1', '2018-11-03 22:21:31', '2018-11-03 22:21:31', 'XXL', '', 'CRON', '0 0 0 * * ? *', 'DO_NOTHING', 'FIRST', 'demoJobHandler', '', 'SERIAL_EXECUTION', 0, 0, 'BEAN', '', 'GLUE代码初始化', '2018-11-03 22:21:31', '');
INSERT INTO `xxl_job_user`(`id`, `username`, `password`, `role`, `permission`) VALUES (1, 'admin', 'e10adc3949ba59abbe56e057f20f883e', 1, NULL);
INSERT INTO `xxl_job_lock` ( `lock_name`) VALUES ( 'schedule_lock');

commit;
```
执行完后，会构建xxl_job数据库和多张数据表，如下：
![12.png](/images/k8s-xxl/12.png)
至此，mysql部署完成

### 搭建xxl-job
因为mysql执行的sql是对应2.3.1版本，所以我们部署2.3.1版本的xxl-job-admin
**xxl-job-admin.yaml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: xxl-job-admin
spec:
  replicas: 1
  selector:
    matchLabels:
      app: xxl-job-admin
  template:
    metadata:
      labels:
        app: xxl-job-admin
    spec:
      containers:
      - name: xxl-job-admin
        image: xuxueli/xxl-job-admin:2.3.1 # 使用2.3.1版本
        imagePullPolicy: Always     # 优先使用本地镜像
        ports:
        - containerPort: 8080
        env:
        - name: PARAMS   # 定义变量，用来设定mysql的用户/密码 mysql为k8s集群内的service名称，在k8s集群内部可以直接使用service名称，使用时mail替换成自己的邮箱和密码
          value: "--spring.datasource.url=jdbc:mysql://mysql:3306/xxl_job?Unicode=true&characterEncoding=UTF-8&useSSL=false --spring.datasource.username=root --spring.datasource.password=password --spring.mail.username=your-email@163.com --spring.mail.password=your-pass"
---
apiVersion: v1
kind: Service
metadata:
  name: xxl-job-admin
  labels:
    app: xxl-job-admin
spec:
  ports:
  type: NodePort
  ports:
  - port: 8080
    targetPort: 8080
    nodePort: 30080 # nodeport映射到本机的30080端口
  selector:
    app: xxl-job-admin
```
执行命令
```shell
kubectl apply -f xxl-job-admin.yaml
```
查看对应的svc、deployment和pod，如下：
![13.png](/images/k8s-xxl/13.png)
至此，xxl-job-admin部署完成，可通过浏览器访问[http://localhost:30080/xxl-job-admin/toLogin](http://localhost:30080/xxl-job-admin/toLogin)进行登陆(用户名/密码 = admin/123456)，如下：
![14.png](/images/k8s-xxl/14.png)

## 构造执行器测试xxl-job
因为xxl-job-admin的pod可以与本机进行通信，所以可以使用xxl-job-executor-go本地构造一个执行器，完成注册执行器，创建任务，执行任务，回调日志等测试闭环，执行器代码如下：
```golang
package main

import (
   "fmt"
   "github.com/xxl-job/xxl-job-executor-go"
   "github.com/xxl-job/xxl-job-executor-go/example/task"
   "log"
)

func main() {
   exec := xxl.NewExecutor(
      xxl.ServerAddr("http://127.0.0.1:30080/xxl-job-admin"),
      xxl.AccessToken("default_token"), //请求令牌(使用默认的default_token)
      //xxl.ExecutorIp("127.0.0.1"),      //可自动获取
      //xxl.ExecutorPort("9999"),         //默认9999（非必填）
      xxl.RegistryKey("executor"), //执行器名称
      //xxl.SetLogger(&logger{}),         //自定义日志
   )
   exec.Init()
   //设置日志查看handler
   exec.LogHandler(func(req *xxl.LogReq) *xxl.LogRes {
      return &xxl.LogRes{Code: 200, Msg: "", Content: xxl.LogResContent{
         FromLineNum: req.FromLineNum,
         ToLineNum:   2,
         LogContent:  "这个是自定义日志handler",
         IsEnd:       true,
      }}
   })
   //注册任务handler
   exec.RegTask("task.test", task.Test)
   exec.RegTask("task.test2", task.Test2)
   exec.RegTask("task.panic", task.Panic)
   log.Fatal(exec.Run())
}

//xxl.Logger接口实现
type logger struct{}

func (l *logger) Info(format string, a ...interface{}) {
   fmt.Println(fmt.Sprintf("自定义日志 - "+format, a...))
}

func (l *logger) Error(format string, a ...interface{}) {
   log.Println(fmt.Sprintf("自定义日志 - "+format, a...))
}
```
构建执行器：
![15.png](/images/k8s-xxl/15.png)
构造任务：
![16.png](/images/k8s-xxl/16.png)
启动执行器，进行执行器注册，将本机ip注册到xxl-job-admin中：
![17.png](/images/k8s-xxl/17.png)
![18.png](/images/k8s-xxl/18.png)
启动任务，固定间隔3秒执行一次：
![19.png](/images/k8s-xxl/19.png)
![20.png](/images/k8s-xxl/20.png)
执行日志：
![21.png](/images/k8s-xxl/21.png)
至此，基于k8s的xxl-job测试环境部署完成