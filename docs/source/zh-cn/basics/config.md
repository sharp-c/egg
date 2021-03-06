title: 配置
---

# 配置

## config 配置

框架提供了强大且可扩展的配置功能，可以自动合并应用、插件、框架的配置，按顺序覆盖，且可以根据环境维护不同的配置。合并后的配置可直接从 `app.config` 获取。

配置的管理有多种方案，以下列一些常见的方案

1. 使用平台管理配置，应用构建时将当前环境的配置放入包内，启动时指定该配置。但应用就无法一次构建多次部署，而且本地开发环境想使用配置会变的很麻烦。
1. 使用平台管理配置，在启动时将当前环境的配置通过环境变量传入，这是比较优雅的方式，但框架对运维的要求会比较高，需要部署平台支持，同时开发环境也有相同痛点。
1. 使用代码管理配置，在代码中添加多个环境的配置，在启动时传入当前环境的参数即可。但无法全局配置，必须修改代码。

我们选择了最后一种配置方案，**配置即代码**，配置的变更也应该经过 review 后才能发布。应用包本身是可以部署在多个环境的，只需要指定运行环境即可。

### 多环境配置

框架支持根据环境来加载配置，定义多个环境的配置文件，具体环境请查看[运行环境配置](./env.md)

```
config
|- config.default.js
|- config.test.js
|- config.prod.js
|- config.unittest.js
`- config.local.js
```

`config.default.js` 为默认的配置文件，所有环境都会加载这个配置文件，一般也会作为开发环境的默认配置文件。

当指定 serverEnv 时会同时加载对应的配置文件，并覆盖默认配置文件的同名配置。如 prod 环境会加载 `config.prod.js` 和 `config.default.js` 文件，`config.prod.js` 会覆盖 `config.default.js` 的同名配置。

### 配置写法

配置文件返回的是一个 object 对象，可以覆盖框架的一些配置，应用也可以将自己业务的配置放到这里方便管理。

```js
// 配置 logger 文件的目录，logger 默认配置由框架提供
module.exports = {
  logger: {
    dir: '/home/admin/logs/demoapp',
  },
};
```

配置文件也可以返回一个 function，可以接受 appInfo 参数

```js
// 将 logger 目录放到代码目录下
const path = require('path');
module.exports = appInfo => {
  return {
    logger: {
      dir: path.join(appInfo.baseDir, 'logs'),
    },
  };
};
```

内置的 appInfo 有

appInfo | 说明
--- | ---
pkg | package.json
name | 应用名，同 pkg.name
baseDir | 应用代码的目录
HOME | 用户目录，如 admin 账户为 /home/admin
root | 应用根目录，只有在 local 和 unittest 环境下为 baseDir，其他都为 HOME。

`appInfo.root` 是一个优雅的适配，比如在服务器环境我们会使用 `/home/admin/logs` 作为日志目录，而本地开发时又不想污染用户目录，这样的适配就很好解决这个问题。

### 配置加载顺序

应用、插件、框架都可以定义这些配置，而且目录结构都是一致的，但存在优先级（应用 > 框架 > 插件），相对于此运行环境的优先级会更高。

比如在 prod 环境加载一个配置的加载顺序为

```
-> 插件 config.default.js
-> 框架 config.default.js
-> 应用 config.default.js
-> 插件 config.prod.js
-> 框架 config.prod.js
-> 应用 config.prod.js
```

**注意：插件之间也会有加载顺序，但大致顺序类似，具体逻辑可[查看加载器](../advanced/loader.md)。**

配置的合并是使用 [extend](https://github.com/justmoon/node-extend) 模块进行深度拷贝，但存在数组合并的问题。

```js
const a = {
  arr: [ 1, 2 ],
};
const b = {
  arr: [ 3 ],
};
extend(true, a, b);
// => { arr: [ 3, 2 ] }
```

因为 extend 把所有都当做对象处理，数组也是一个对象，所以 b 覆盖了 a 的第一个索引。**尽量不要定义数组配置，可使用字符串分隔符代替。**

修改一下上面的例子，将配置改成字符串，使用的时候再转成数组。

```js
const a = {
  arr: '1,2',
};
const b = {
  arr: '1,2,3',
};
const c = extend(true, a, b);
const arr = c.arr.split(',');
// => [ '1', '2', '3' ]
```

## 插件配置

在应用中可以通过 `config/plugin.js` 来控制插件的一些选项。

### 开启关闭

框架有一些内置的插件，通过配置可以开启或关闭插件。插件关闭后，插件内所有的文件都不会被加载。

```js
// 关闭内置的 i18n 插件
module.exports = {
  i18n: {
    enable: false,
  },
};
```

或可以简单的配置一个布尔值

```js
module.exports = {
  i18n: false,
};
```

### 新增插件

框架默认内置了[一部分插件](https://github.com/eggjs/egg/blob/master/config/plugin.js)。如果由应用添加插件，那么需要指定 package 配置。

```js
// 使用 mysql 插件
module.exports = {
  mysql: {
    enable: true,
    package: 'egg-mysql',
  },
};
```

package 为一个 npm 模块，必须添加依赖到 `pkg.dependencies` 中。框架会在 node_modules 目录中找到这个模块作为插件入口。

```json
{
  "dependencies": {
    "egg-mysql": "^1.0.0"
  }
}
```

也可以指定 path 来替代 package。

```js
const path = require('path');
module.exports = {
  mysql: {
    enable: true,
    path: path.join(__dirname, '../app/plugins/egg-mysql'),
  },
};
```

path 为一个绝对路径，这样应用可以把自己写的插件直接放到应用目录中，如 `app/plugins` 目录。
