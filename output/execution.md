# 执行验证报告（execution.md）

日期：2026-09-12 ｜ 验证人：Claude

## 1. 验证环境

本机无 Docker/Go，按 docker-compose.yml 的端口规划在本机直起等价服务：

| 组件 | 版本 | 端口 | 说明 |
| --- | --- | --- | --- |
| Go | 1.22.12 linux/arm64 | - | 后端构建与测试 |
| MySQL | 8.0.40（generic tarball） | 10180 | 与 compose 一致，库 oralhistory_db |
| SeaweedFS | 4.46（S3 兼容） | 47026 | 替代 MinIO（MinIO 社区版已停止分发二进制）；桶 oralhistory-audio，凭据 minioadmin/minioadmin123 |
| Redis | 未安装 | - | 后端设计为 ping 失败自动降级（限流关闭），不阻塞启动 |
| Node | 20.20.2 | - | 前端构建、E2E 脚本 |
| Chromium | 131 headless | - | 页面级验证（playwright-core） |

后端 `SERVER_PORT=9180`，前端 `vite preview` 8180（/api 代理到 9180）。

## 2. 构建验证

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 后端静态检查 | `go vet ./...` | 通过 |
| 后端单元测试 | `go test ./...` | 16 个测试全部 PASS（repository 6 + service 10，含新增授权守卫用例） |
| 后端构建 | `go build ./cmd/server` | 通过，产出 17MB 二进制 |
| 前端类型检查+构建 | `npm run build`（tsc -b && vite build） | 通过，dist 产物 JS 290KB / CSS 8.7KB |
| 前端服务 | `vite preview :8180` + `/api` 代理 | 200，代理登录接口 200 |

## 3. 接口验证（scripts/e2e-verify.mjs，51/51 通过）

三角色全链路 + 全部拒绝路径：

- **注册与角色**：公开注册固定为采访员；注册携带 `role=admin` 仍落为采访员；仅管理员可 `PUT /users/:id/role`；采访员查账号列表、档案员查审计日志均 403。
- **建档**：采访员建项目（受访者/出生年份/背景）；档案员建项目 403；采访员乙改甲的项目 403；非法状态流转 409。
- **提纲**：负责采访员可加问题；档案员/非负责采访员加问题 403。
- **录音问答**：录音创建→上传音频→状态 ready，自动关联对应问题（project_id/question_id/audio_key 校验）；录音挂到别的项目的问题 400；档案员/非负责采访员建录音 403。
- **摘要与节点**：档案员写摘要、标节点；采访员写摘要/标节点 403；节点挂到别的项目的录音 400。
- **归档**：采访员标记完成，档案员归档；归档后改资料/加问题/建录音/改摘要/加节点/删问题/状态流转全部 409。
- **回放**：项目片段按时间顺序（id ASC）返回；节点按时间戳排序；`GET /recordings/:id/audio` 200 且字节与上传一致；未认证 401。
- **管理员**：账号列表含新注册用户；审计日志覆盖 project.create / project.status / recording.upload / recording.summary / marker.create。

## 4. 页面验证（headless Chromium，23/23 通过）

- **登录/注册页**：渲染正常；注册即登录且顶栏显示「采访员」；无账号管理/审计导航。
- **采访员**：列表页新建项目 → 详情页展示受访者资料 → 开始采访（状态→进行中）→ 添加提纲 → 采访工作台选择问题 → 假麦克风录音 2.5s → 上传成功并关联问题 → 录音面板出现播放器。
- **档案员**：无新建项目按钮；详情页时间线展示片段与播放器；在时间线上写摘要并展示；标注节点成功；完成→归档；归档后添加问题表单消失。
- **管理员**：导航含账号管理/审计日志；账号页列出新注册用户、角色下拉可调整；审计页含建档/录音/摘要/节点记录。
- **时间轴回放**：详情页时间线展示片段，点击播放后进度推进。

## 5. 验证中发现并修复的缺陷

1. **注册提权**：`POST /auth/register` 接受客户端 `role` 字段，可自封管理员 → 服务端固定为 interviewer，DTO 移除 role。
2. **越权写入**：项目/提纲/录音/摘要/节点的写接口仅校验登录 → service 层新增 `authz.go`（角色白名单 + 负责人校验 + 归档只读）。
3. **跨项目挂接**：录音不校验问题归属、节点不校验录音归属 → 创建时校验 `question.project_id` / `recording.project_id`，违反返回 400。
4. **归档后可写**：归档项目可继续加问题/录音/摘要/节点 → 全部写路径加归档校验，返回 409。
5. **录音时长恒为 0**（前端）：`MediaRecorder.onstop` 闭包捕获旧 `seconds` → 改用 `secondsRef` 读取实时秒数。
6. **0 秒节点被 400**：`timestamp_second` 的 `binding:"required"` 拒绝合法的 0 → 改为 `min=0`。

## 6. 遗留说明

- 本地验证用 SeaweedFS 替代 MinIO（S3 兼容，minio-go 直连通过）；Docker 部署仍使用 compose 中的 MinIO 镜像，代码无改动。
- Redis 未本地安装，后端按设计降级（限流关闭）；compose 部署时自动启用。
