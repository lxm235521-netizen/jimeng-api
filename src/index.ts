"use strict";

import environment from "@/lib/environment.ts";
import config from "@/lib/config.ts";
import "@/lib/initialize.ts";
import server from "@/lib/server.ts";
import routes from "@/api/routes/index.ts";
import logger from "@/lib/logger.ts";
import { startTokenDailyResetJob, startTokenHealthcheckJob } from "@/lib/token-healthcheck.ts";

const startupTime = performance.now();

(async () => {
  logger.header();

  logger.info("<<<< jimeng-api >>>>");
  logger.info("Version:", environment.package.version);
  logger.info("Process id:", process.pid);
  logger.info("Environment:", environment.env);
  logger.info("Service name:", config.service.name);

  server.attachRoutes(routes);

  // Token 池存活检测：默认每 4 小时跑一次
  // 注意：runOnStart 设为 false，避免服务每次重启时因为网络波动等原因
  // 误把仍然可用的 token 标记为 invalid。需要时可在管理后台手动触发健康检查。
  startTokenHealthcheckJob({
    schedule: "0 */4 * * *",
    runOnStart: false,
    batchSize: 20,
    delayMs: 250,
  });

  // Token 池状态重置：每天北京时间 00:00 把所有 token 置为可用
  startTokenDailyResetJob();

  await server.listen();

  config.service.bindAddress &&
    logger.success("Service bind address:", config.service.bindAddress);
})()
  .then(() =>
    logger.success(
      `Service startup completed (${Math.floor(performance.now() - startupTime)}ms)`
    )
  )
  .catch((err) => console.error(err));
