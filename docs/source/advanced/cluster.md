title: 多进程模型
---

# 多进程模型

## 背景

大家知道 Nodejs 是单进程、单线程的，为了充分地利用多核 CPU，官方提供了 `cluster` 模块，可以让多个进程监听同一个端口。该方案已经非常成熟且广泛被使用，但它也会带来一些额外的开销和问题。例如：一些中间件需要和服务器建立长连接，理论上一台服务器最好只建立一个长连接，因为它是非常宝贵的资源，但 cluster 模式会导致 n 倍（n = 进程数）的连接被创建。另外，有些工作是只能由一个进程来做的，比如：日志切分等等。所以，我们需要一个方案来协调多个进程间的职责和共享资源。

普通 cluster 模式下，每个进程都会和服务端创建连接

```bash
+--------+   +--------+
| Client |   | Client |   ...
+--------+   +--------+
    |  \     /   |
    |    \ /     |
    |    / \     |
    |  /     \   |
+--------+   +--------+
| Server |   | Server |   ...
+--------+   +--------+
```

## 解决方案

### 核心思想

- 受到 [Leader/Follower](http://www.cs.wustl.edu/~schmidt/PDF/lf.pdf) 模式的启发
- 客户端会被区分为两种角色：
  - Leader: 负责和 server 端维持连接的实例，对于一类客户端只有一个 Leader
  - Follower: 类似代理的“假”实例，它和 Leader 间通过 socket 连接，并且把请求代理给 Leader
- 客户端启动的时候通过本地端口的争夺来确定 Leader。例如：大家都尝试监听 7777 端口，最后只会有一个实例抢占到，那它就变成 Leader，其余的都是 Follower

新的模式下，客户端的启动流程如下：

```js
             +-------+
             | start |
             +---+---+
                 |
        +--------+---------+
      __| port competition |__
win /   +------------------+  \ lose
   /                           \
+--------+     tcp conn     +----------+
| Leader |<---------------->| Follower |
+--------+                  +----------+
    |
+--------+
| Client |
+--------+
    |  \
    |    \
    |      \
    |        \
+--------+   +--------+
| Server |   | Server |   ...
+--------+   +--------+

```

### 客户端接口类型抽象

我们将客户端接口抽象为下面两大类，这也是对客户端接口的一个规范，对于符合规范的客户端，我们可以自动将其包装为 Leader/Follower 模式

- 订阅、发布类（subscribe / publish）
  - subscribe 接口包含两个参数，第一个是订阅的信息，第二个是订阅的回调函数
  - publish 接口包含一个参数，就是订阅的信息
- 调用类 (invoke)，支持 callback, promise 和 generator 三种风格的接口，但是推荐使用 generator

客户端示例
```js
const Base = require('sdk-base');

class Client extends Base {
  constructor(options) {
    super(options);
    // 在初始化成功以后记得 ready
    this.ready(true);
  }

  /**
   * 订阅
   * 
   * @param {Object} info - 订阅的信息（一个 JSON 对象，注意尽量不要包含 Function, Buffer, Date 这类属性）
   * @param {Function} listener - 监听的回调函数，接收一个参数就是监听到的结果对象
   */
  subscribe(info, listener) {
    // ...
  }

  /**
   * 发布
   *
   * @param {Object} info - 发布的信息，和上面 subscribe 的 info 类似
   */
  publish(info) {
    // ...
  }

  /**
   * 获取数据 (invoke)
   *
   * @param {String} id - id
   * @return {Object} result
   */
  * getData(id) {
    // ...
  }
}
```

### 异常处理

- Leader 如何“死掉”会触发新一轮的端口争夺，争夺到端口的那个实例被推选为新的 Leader
- 为保证 Leader 和 Follower 之间的通道健康，需要引入定时心跳检查机制，如果 Follower 在固定时间内没有发送心跳包，那么 Leader 会将 Follower 主动断开，从而触发 Follower 的重新初始化

### 协议和调用时序

Leader 和 Follower 通过下面的协议进行数据交换：

```js
 0       1       2               4                                                              12
 +-------+-------+---------------+---------------------------------------------------------------+
 |version|req/res|    reserved   |                          request id                           |
 +-------------------------------+-------------------------------+-------------------------------+
 |           timeout             |   connection object length    |   application object length   |
 +-------------------------------+---------------------------------------------------------------+
 |         conn object (JSON format)  ...                    |            app object             |
 +-----------------------------------------------------------+                                   |
 |                                          ...                                                  |
 +-----------------------------------------------------------------------------------------------+
```

1. Follower 连接上 server 后，首先发送一个 register channel 的 packet（引入 channel 的概念是为了区别不同类型的客户端）
2. Server 会将 Follower 分配给指定的 Leader（根据客户端类型进行配对）
3. Follower 向 Leader 发送订阅、发布请求，
4. Leader 在订阅数据变更时通过 subscribe result packet 通知 Follower
5. Follower 向 Leader 发送调用请求，Leader 收到后执行相应操作后返回结果

```js
 +----------+             +---------------+          +---------+ 
 | Follower |             |  local server |          |  Leader |
 +----------+             +---------------+          +---------+ 
      |     register channel     |       assign to        |
      + -----------------------> |  --------------------> |
      |                          |                        |
      |                                subscribe          |
      + ------------------------------------------------> |
      |       subscribe result                            |
      | <------------------------------------------------ +
      |                                                   |
      |                                 invoke            |
      + ------------------------------------------------> |
      |          invoke result                            |
      | <------------------------------------------------ +
      |                                                   |
```

## 在 Egg 里如何使用

cluster 模式一般包含 Master 和 Worker 两种进程，而对于 Egg 应用来说，我们还有一个特殊的进程叫: Agent Worker，简称 Agent。Agent 的定位就是一个后台进程，负责运行一些和业务无关的逻辑，这和我们上面讲到的 Leader 的职责其实是匹配的，所以在 Egg 里面我们强约定 Leader 只能由 Agent 充当，换句话说 App Worker 只能作为 Follower，这样做最主要的考量是：降低业务异常对于中间件客户端的影响。

下面我用一个简单的例子，介绍在 Egg 里面如何让一个客户端支持 Leader/Follower 模式

- 第一步，我们的客户端最好是符合上面提到过的接口约定，例如：

```js
'use strict';

const URL = require('url');
const Base = require('sdk-base');

class RegistryClient extends Base {
  constructor(options) {
    super();
    this._options = options;
    this._registered = new Map();
    this.ready(true);
  }

  /**
   * 获取配置
   * @param {String} dataId - the dataId
   * @return {Object} 配置
   */
  * getConfig(dataId) {
    return this._registered.get(dataId);
  }

  /**
   * 订阅
   * @param {Object} reg
   *   - {String} dataId - the dataId
   * @param {Function}  listener - the listener
   */
  subscribe(reg, listener) {
    const key = reg.dataId;
    this.on(key, listener);

    const data = this._registered.get(key);
    if (data) {
      process.nextTick(() => listener(data));
    }
  }

  /**
   * 发布
   * @param {Object} reg
   *   - {String} dataId - the dataId
   *   - {String} publishData - the publish data
   */
  publish(reg) {
    const key = reg.dataId;
    let changed = false;

    if (this._registered.has(key)) {
      const arr = this._registered.get(key);
      if (arr.indexOf(reg.publishData) === -1) {
        changed = true;
        arr.push(reg.publishData);
      }
    } else {
      changed = true;
      this._registered.set(key, [reg.publishData]);
    }
    if (changed) {
      this.emit(key, this._registered.get(key).map(url => URL.parse(url, true)));
    }
  }
}

module.exports = RegistryClient;
```

- 第二步，在 ${baseDir}/agent.js 中使用 agent.cluster 接口对 RegistryClient 进行封装

```js
'use strict';

const RegistryClient = require('registry_client');

module.exports = function(agent) {
  const done = agent.readyCallback('register_client', {
    isWeakDep: agent.config.runMode === 0,
  });
  // 对 RegistryClient 进行封装和实例化
  agent.registryClient = agent.cluster(RegistryClient)
    // create 方法的参数就是 RegistryClient 构造函数的参数
    .create({});
  agent.registryClient.ready(done);
};
```

- 第三步，在 ${baseDir}/app.js 中使用 app.cluster 接口对 RegistryClient 进行封装

```js
'use strict';

const co = require('co');
const RegistryClient = require('registry_client');

module.exports = function(app) {
  const done = app.readyCallback('register_client', {
    isWeakDep: app.config.runMode === 0,
  });
  app.registryClient = app.cluster(RegistryClient).create({});
  app.registryClient.ready(done);

  // 调用 subscribe 进行订阅
  app.registryClient.subscribe({
    dataId: 'demo.DemoService',
  }, val => {
    // ...
  });

  // 调用 publish 发布数据
  app.registryClient.publish({
    dataId: 'demo.DemoService',
    publishData: 'xxx',
  });

  co(function*() {
    // 调用 getConfig 接口
    const res = yeild app.registryClient.getConfig('demo.DemoService');
    // ...
  }).catch(err => app.coreLogger.error(err));
};
```

是不是很简单？

当然，如果你的客户端不是那么“标准”，那你可能需要用到其他一些 API，比如，你的订阅函数不叫 subscribe，叫 sub

```js
class MockClient extends Base {
  // ...

  sub(info, listener) { // ... }

  // ...
}
```

你需要用 delegate API 手动设置

agent.js
```js
module.exports = function(agent) {
  agent.mockClient = agent.cluster(MockClient)
    .delegate('sub', 'subscribe')
    .create();
};
```

app.js
```js
module.exports = function(agent) {
  agent.mockClient = agent.cluster(MockClient)
    .delegate('sub', 'subscribe')
    .create();
};
```

如果在原来的客户端基础上，你还想增加一些 api，你可以使用 override API 

app.js
```js
module.exports = function(agent) {
  agent.mockClient = agent.cluster(MockClient)
    .delegate('sub', 'subscribe')
    // 增加一个 xxx 的方法
    .override('xxx', function() {
      return 'xxx';
    })
    .create();
};
```
