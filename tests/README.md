# 自动化测试（tests/）

覆盖登录、角色调整、项目负责人隔离、提纲与录音归属、摘要与节点权限、归档只读、录音回放。
接口测试同时覆盖正常流程与越权、跨项目、非法状态流转等失败路径；浏览器测试走通三种角色并检查录音播放。

## 目录

```
tests/
├── api/api.e2e.mjs        # 接口测试（零依赖，Node ≥ 18 即可运行）
├── browser/roles.e2e.mjs  # 浏览器测试（playwright-core + headless Chromium）
├── helpers/
│   ├── apiClient.mjs      # fetch 封装
│   ├── fixtures.mjs       # 测试数据固件（确定性 WAV、用户/项目数据）
│   └── report.mjs         # 断言收集 + 报告写出
├── reports/               # 每次运行生成 <套件>-latest.md 与 <套件>-<时间戳>.json
└── package.json
```

## 前置条件

- 后端运行在 `http://127.0.0.1:9180`（或设置 `API_BASE`）
- 浏览器测试另需前端运行在 `http://127.0.0.1:8180`（或设置 `FRONTEND_BASE`）
- 数据库中已播种默认管理员 `admin / admin123456`（或设置 `ADMIN_PASSWORD`）

每次运行自动生成随机后缀的测试账号与项目，可重复执行，互不干扰；测试数据保留在数据库中便于排查。

## 运行

```bash
# 接口测试（无需安装依赖）
node tests/api/api.e2e.mjs
# 或
npm --prefix tests run test:api

# 浏览器测试（首次需安装依赖与浏览器）
cd tests && npm install
npx playwright-core install chromium-headless-shell   # 或设置 CHROMIUM_PATH
npm run test:browser

# 全部
npm --prefix tests test
```

环境变量：`API_BASE`、`FRONTEND_BASE`、`CHROMIUM_PATH`、`ADMIN_PASSWORD`。

## 断言规模

- 接口测试 `api-e2e`：约 60 项断言，分 12 组——登录与注册、角色调整、负责人隔离、
  状态机非法流转、提纲归属、录音归属、摘要与节点权限、归档只读、回放、未认证、审计。
- 浏览器测试 `browser-e2e`：约 20 项断言，分 5 组——采访员全流程（含假麦克风真实录音上传）、
  档案员整理与归档、管理员账号与审计、时间轴回放播放进度。

## 测试报告

每次运行结束后在 `tests/reports/` 下写出：

- `<套件>-latest.md`：最近一次运行的逐项断言表（覆盖更新）
- `<套件>-<时间戳>.json`：当次运行的完整机器可读结果（累计保留）

退出码：全部通过为 0，任一断言失败为 1，可直接接入 CI。
