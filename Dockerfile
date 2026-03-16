# 构建阶段
# Vite 需要 Node 20.19+（或 22.12+），因此构建阶段使用更高版本
FROM node:22-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装构建依赖（包括Python和make，某些npm包需要）
RUN apk add --no-cache python3 make g++

# 复制 package 文件以优化 Docker 层缓存
COPY package.json package-lock.json ./
COPY web-ui/package.json web-ui/package-lock.json ./web-ui/

# 安装所有依赖（包括devDependencies）
RUN npm ci --registry https://registry.npmmirror.com/

# 安装 web-ui 依赖（在 Linux 镜像内安装，避免拷贝 Windows 的 node_modules）
RUN cd web-ui && npm ci --registry https://registry.npmmirror.com/

# 复制源代码（配合 .dockerignore 排除 node_modules）
COPY . .

# 接收版本号参数并更新 package.json
ARG VERSION
RUN if [ -n "$VERSION" ]; then \
    echo "Updating package.json version to $VERSION"; \
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json; \
    cat package.json | grep version; \
    fi

# 构建应用
# 先构建 Web 管理后台（产物写入 public/admin），再构建后端 dist
RUN npm run web:build && npm run build

# 生产阶段
FROM node:22-alpine AS production

# 安装健康检查工具
RUN apk add --no-cache wget

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S jimeng -u 1001

# 设置工作目录
WORKDIR /app

# 复制 package.json（使用构建阶段已更新版本）与 package-lock.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

# 只安装生产依赖
RUN npm ci --omit=dev --registry https://registry.npmmirror.com/ && \
    npm cache clean --force

# 从构建阶段复制构建产物
COPY --from=builder --chown=jimeng:nodejs /app/dist ./dist
COPY --from=builder --chown=jimeng:nodejs /app/configs ./configs
COPY --from=builder --chown=jimeng:nodejs /app/public ./public

# 创建应用需要的目录并设置权限
RUN mkdir -p /app/logs /app/tmp && \
    chown -R jimeng:nodejs /app/logs /app/tmp

# 设置环境变量
ENV SERVER_PORT=5100

# 切换到非root用户
USER jimeng

# 暴露端口
EXPOSE 5100

# 健康检查
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider http://localhost:5100/ping

# 启动应用
CMD ["npm", "start"]
