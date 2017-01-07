'use strict';

const cluster = require('cluster-client');
const Singleton = require('../../lib/core/singleton');

// 空的 instrument 返回，用于生产环境，避免每次创建对象
const emptyInstrument = {
  end() {},
};

module.exports = {

  /**
   * 创建一个单例并添加到 app/agent 上
   * @method Agent#addSingleton
   * @param {String} name 单例的唯一名字
   * @param {Object} create - 单例的创建方法
   */
  addSingleton(name, create) {
    const options = {};
    options.name = name;
    options.create = create;
    options.app = this;
    const singleton = new Singleton(options);
    singleton.init();
  },

  /**
   * 记录操作的时间
   * @method Agent#instrument
   * @param  {String} event 类型
   * @param  {String} action 具体操作
   * @return {Object} 对象包含 end 方法
   * @example
   * ```js
   * const ins = agent.instrument('http', `${method} ${url}`);
   * // doing
   * ins.end();
   * ```
   */
  instrument(event, action) {
    if (this.config.env !== 'local') {
      return emptyInstrument;
    }
    const payload = {
      start: Date.now(),
      agent: this,
      event,
      action,
    };

    return {
      end() {
        const start = payload.start;
        const duration = Date.now() - start;
        payload.agent.logger.info(`[${payload.event}] ${payload.action} ${duration}ms`);
      },
    };
  },

  /**
   * 将客户端封装为 "cluster" 模式
   *
   * @see https://github.com/node-modules/cluster-client
   * @method Agent#cluster
   * @param {Function} clientClass - 客户端构造函数
   * @param {Object} [options]
   *   - {Boolean} [autoGenerate] - 是否自动生成代理方法，默认为 true
   *   - {Function} [formatKey] - 将订阅信息转换为一个唯一的字符串，默认为 JSON.stringify
   *   - {Object} [transcode] - 自定义序列化对象，默认为 JSON.stringify/JSON.parse
   *   - {Boolean} [isBroadcast] - 订阅消息是否广播，默认为 true，如果设置为 false，只会随机选择一个订阅者发送
   *   - {Number} [responseTimeout] - 进程间超时时长，默认为 3 秒
   *   - {Number} [maxWaitTime] - Follower 等待 Leader 启动的最大时长，默认为 30 秒
   * @return {ClientWrapper} 封装后实例
   */
  cluster(clientClass, options) {
    options = options || {};
    // master 启动的时候随机分配的一个端口，保证在一台机器上不冲突
    options.port = this._options.clusterPort;
    // agent worker 来做 leader
    options.isLeader = true;
    options.logger = this.coreLogger;
    return cluster(clientClass, options);
  },
};
