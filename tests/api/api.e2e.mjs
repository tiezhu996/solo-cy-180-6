/**
 * 接口端到端测试：正常流程 + 越权/跨项目/非法状态流转等失败路径。
 *
 * 覆盖：登录、角色调整、项目负责人隔离、提纲与录音归属、
 *       摘要与节点权限、归档只读、录音回放。
 *
 * 运行：node tests/api/api.e2e.mjs [API_BASE]
 * 默认 API_BASE=http://127.0.0.1:9180/api/v1，也可用环境变量 API_BASE 指定。
 * 每次运行生成随机后缀的测试数据，可重复执行。
 */
import { ApiClient } from '../helpers/apiClient.mjs'
import { makeFixture, makeWav } from '../helpers/fixtures.mjs'
import { TestRun } from '../helpers/report.mjs'

const API_BASE = process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:9180/api/v1'
const api = new ApiClient(API_BASE)
const fx = makeFixture()
const wav = makeWav()
const run = new TestRun('api-e2e')

const tokens = {}
const ids = {}

async function login(username, password) {
  const res = await api.post('/auth/login', { body: { username, password } })
  return res
}

async function main() {
  console.log(`接口测试 @ ${API_BASE}（数据后缀 ${fx.suffix}）`)

  // ---------- 登录与注册 ----------
  run.section('登录与注册')
  {
    const health = await fetch(API_BASE.replace(/api\/v1$/, 'healthz')).then((r) => r.json())
    run.check('服务健康检查 db=true', health?.data?.db === true)

    const reg = await api.post('/auth/register', { body: { username: fx.users.interviewerA, password: fx.password, display_name: '采访员甲' } })
    run.check('公开注册成功且默认角色为采访员', reg.code === 0 && reg.data.role === 'interviewer')

    const esc = await api.post('/auth/register', { body: { username: fx.users.escalate, password: fx.password, display_name: '提权尝试', role: 'admin' } })
    run.check('注册携带 role=admin 仍落为采访员', esc.code === 0 && esc.data.role === 'interviewer')

    const dup = await api.post('/auth/register', { body: { username: fx.users.interviewerA, password: fx.password, display_name: '重复用户' } })
    run.check('重复用户名注册被拒(409)', dup.status === 409)

    const ok = await login(fx.users.interviewerA, fx.password)
    run.check('正确口令登录成功并签发 JWT', ok.code === 0 && !!ok.data.token)
    tokens.admin = (await login(fx.admin.username, fx.admin.password)).data?.token
    run.check('默认管理员可登录', !!tokens.admin)

    const wrong = await login(fx.users.interviewerA, 'wrong-password')
    run.check('错误密码登录被拒(401)', wrong.status === 401)
    const ghost = await login(`nobody_${fx.suffix}`, fx.password)
    run.check('不存在用户登录被拒(401)', ghost.status === 401)

    const me = await api.get('/auth/me', { token: ok.data.token })
    run.check('携带 JWT 访问 /auth/me 返回本人', me.code === 0 && me.data.username === fx.users.interviewerA)
    const meAnon = await api.get('/auth/me')
    run.check('未认证访问 /auth/me 被拒(401)', meAnon.status === 401)
  }

  // ---------- 角色调整 ----------
  run.section('角色调整（仅管理员）')
  {
    for (const [key, username] of Object.entries({ interviewerB: fx.users.interviewerB, archivist: fx.users.archivist })) {
      await api.post('/auth/register', { body: { username, password: fx.password, display_name: username } })
      tokens[key] = (await login(username, fx.password)).data.token
    }
    tokens.interviewerA = (await login(fx.users.interviewerA, fx.password)).data.token

    const users = await api.get('/users?page=1&page_size=200', { token: tokens.admin })
    run.check('管理员查看账号列表', users.code === 0 && users.data.list.some((u) => u.username === fx.users.archivist))
    ids.archivist = users.data.list.find((u) => u.username === fx.users.archivist).id
    ids.interviewerB = users.data.list.find((u) => u.username === fx.users.interviewerB).id

    const forbidden = await api.get('/users', { token: tokens.interviewerA })
    run.check('采访员查看账号列表被拒(403)', forbidden.status === 403)

    const promoteBySelf = await api.put(`/users/${ids.archivist}/role`, { token: tokens.interviewerA, body: { role: 'admin' } })
    run.check('采访员调整他人角色被拒(403)', promoteBySelf.status === 403)

    const badRole = await api.put(`/users/${ids.archivist}/role`, { token: tokens.admin, body: { role: 'root' } })
    run.check('调整为非法角色被拒(400)', badRole.status === 400)

    const promote = await api.put(`/users/${ids.archivist}/role`, { token: tokens.admin, body: { role: 'archivist' } })
    run.check('管理员将用户调整为档案员', promote.code === 0)

    const relogin = await login(fx.users.archivist, fx.password)
    run.check('角色调整后重新登录生效', relogin.data?.user?.role === 'archivist')
    tokens.archivist = relogin.data.token

    const delAdmin = await api.del('/users/1', { token: tokens.admin })
    run.check('删除管理员账号被拒(403)', delAdmin.status === 403)
    const delByNonAdmin = await api.del(`/users/${ids.interviewerB}`, { token: tokens.interviewerA })
    run.check('非管理员删除账号被拒(403)', delByNonAdmin.status === 403)
  }

  // ---------- 建档与负责人隔离 ----------
  run.section('建档与项目负责人隔离')
  {
    const pA = await api.post('/projects', { token: tokens.interviewerA, body: fx.projectA })
    run.check('采访员甲建档成功（受访者/出生年份/背景）', pA.code === 0 && pA.data.interviewee_name === fx.projectA.interviewee_name)
    ids.projectA = pA.data.id

    const pB = await api.post('/projects', { token: tokens.interviewerB, body: fx.projectB })
    run.check('采访员乙建自己的项目', pB.code === 0)
    ids.projectB = pB.data.id

    const pByArchivist = await api.post('/projects', { token: tokens.archivist, body: { title: '越权项目', interviewee_name: '张三', birth_year: 1950 } })
    run.check('档案员建档被拒(403)', pByArchivist.status === 403)

    const editOther = await api.put(`/projects/${ids.projectA}`, { token: tokens.interviewerB, body: { title: '篡改' } })
    run.check('乙修改甲的项目被拒(403)', editOther.status === 403)
    const delOther = await api.del(`/projects/${ids.projectA}`, { token: tokens.interviewerB })
    run.check('乙删除甲的项目被拒(403)', delOther.status === 403)
    const transOther = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.interviewerB, body: { status: 'in_progress' } })
    run.check('乙流转甲的项目状态被拒(403)', transOther.status === 403)

    const mineA = await api.get('/projects/mine?page=1&page_size=100', { token: tokens.interviewerA })
    run.check('甲的 mine 列表只含甲的项目', mineA.code === 0 && mineA.data.list.some((p) => p.id === ids.projectA) && !mineA.data.list.some((p) => p.id === ids.projectB))

    const editOwn = await api.put(`/projects/${ids.projectA}`, { token: tokens.interviewerA, body: { background: '1953年参军，后转业至纺织厂（补充：获三等功一次）' } })
    run.check('负责人更新自己项目资料', editOwn.code === 0)

    const notFound = await api.get('/projects/999999', { token: tokens.interviewerA })
    run.check('查询不存在项目返回 404', notFound.status === 404)
  }

  // ---------- 非法状态流转 ----------
  run.section('项目状态机（非法流转被拒）')
  {
    const bad1 = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.interviewerA, body: { status: 'completed' } })
    run.check('草稿直接到已完成被拒(409)', bad1.status === 409)
    const bad2 = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.interviewerA, body: { status: 'bogus' } })
    run.check('非法状态值被拒(400)', bad2.status === 400)
    const start = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.interviewerA, body: { status: 'in_progress' } })
    run.check('草稿 → 进行中 允许', start.code === 0 && start.data.status === 'in_progress')
    const back = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.interviewerA, body: { status: 'draft' } })
    run.check('进行中回退草稿被拒(409)', back.status === 409)
    const startB = await api.put(`/projects/${ids.projectB}/status`, { token: tokens.interviewerB, body: { status: 'in_progress' } })
    run.check('乙的项目正常进入采访', startB.code === 0)
  }

  // ---------- 提纲归属 ----------
  run.section('采访提纲归属')
  {
    ids.questions = []
    for (let i = 0; i < fx.questions.length; i++) {
      const q = await api.post(`/projects/${ids.projectA}/questions`, { token: tokens.interviewerA, body: { content: fx.questions[i], sort_order: i } })
      ids.questions.push(q.data?.id)
    }
    run.check('负责人在自己项目添加 3 个提纲问题', ids.questions.every(Boolean))

    const byArchivist = await api.post(`/projects/${ids.projectA}/questions`, { token: tokens.archivist, body: { content: '档案员加问题' } })
    run.check('档案员添加问题被拒(403)', byArchivist.status === 403)
    const byOther = await api.post(`/projects/${ids.projectA}/questions`, { token: tokens.interviewerB, body: { content: '乙给甲加问题' } })
    run.check('非负责人添加问题被拒(403)', byOther.status === 403)

    const qB = await api.post(`/projects/${ids.projectB}/questions`, { token: tokens.interviewerB, body: { content: '乙项目的第一个问题', sort_order: 0 } })
    run.check('乙在自己项目添加问题', qB.code === 0)
    ids.questionB = qB.data.id

    const list = await api.get(`/projects/${ids.projectA}/questions`, { token: tokens.interviewerA })
    run.check('提纲按 sort_order 返回且归属本项目', list.code === 0 && list.data.list.length === 3 && list.data.list.every((q) => q.project_id === ids.projectA))

    const editOther = await api.put(`/questions/${ids.questions[0]}`, { token: tokens.interviewerB, body: { content: '篡改问题' } })
    run.check('乙修改甲项目问题被拒(403)', editOther.status === 403)
    const delOther = await api.del(`/questions/${ids.questions[0]}`, { token: tokens.interviewerB })
    run.check('乙删除甲项目问题被拒(403)', delOther.status === 403)
  }

  // ---------- 录音归属 ----------
  run.section('录音归属（录音落在对应问题上）')
  {
    const [q1, q2] = ids.questions
    const r1 = await api.recordWithAudio(tokens.interviewerA, ids.projectA, q1, 18, wav)
    run.check('问题1 录音创建并上传音频成功', r1.rec?.code === 0 && r1.up?.code === 0 && r1.up?.data?.status === 'ready')
    ids.rec1 = r1.rec?.data?.id
    run.check('录音自动关联对应问题并写入 audio_key', r1.up?.data?.question_id === q1 && r1.up?.data?.project_id === ids.projectA && !!r1.up?.data?.audio_key)

    const r2 = await api.recordWithAudio(tokens.interviewerA, ids.projectA, q1, 12, wav)
    const r3 = await api.recordWithAudio(tokens.interviewerA, ids.projectA, q2, 25, wav)
    ids.rec2 = r2.rec?.data?.id
    ids.rec3 = r3.rec?.data?.id
    run.check('同问题第二段与问题2 录音完成', r2.up?.code === 0 && r3.up?.code === 0)

    const cross = await api.post('/recordings', { token: tokens.interviewerB, body: { project_id: ids.projectB, question_id: q1 } })
    run.check('录音挂到别的项目的问题被拒(400)', cross.status === 400)
    const byArchivist = await api.post('/recordings', { token: tokens.archivist, body: { project_id: ids.projectA, question_id: q1 } })
    run.check('档案员创建录音被拒(403)', byArchivist.status === 403)
    const byOther = await api.post('/recordings', { token: tokens.interviewerB, body: { project_id: ids.projectA, question_id: q1 } })
    run.check('非负责人创建录音被拒(403)', byOther.status === 403)

    const byQuestion = await api.get(`/recordings?question_id=${q1}`, { token: tokens.interviewerA })
    run.check('按问题查询只返回该问题的录音', byQuestion.code === 0 && byQuestion.data.list.length === 2 && byQuestion.data.list.every((r) => r.question_id === q1))
    const byProject = await api.get(`/recordings?project_id=${ids.projectA}`, { token: tokens.interviewerA })
    const recIds = byProject.data.list.map((r) => r.id)
    run.check('项目片段按时间顺序（创建先后）排列', recIds.join(',') === [...recIds].sort((a, b) => a - b).join(','))

    const noAudio = await api.post('/recordings', { token: tokens.interviewerB, body: { project_id: ids.projectB, question_id: ids.questionB } })
    ids.recNoAudio = noAudio.data?.id
    const play404 = await api.get(`/recordings/${ids.recNoAudio}/audio`, { token: tokens.interviewerB })
    run.check('无音频的录音回放返回 404', play404.status === 404)
  }

  // ---------- 摘要与节点权限 ----------
  run.section('摘要与时间轴节点权限')
  {
    const s1 = await api.put(`/recordings/${ids.rec1}/summary`, { token: tokens.archivist, body: { summary: fx.summaries[0] } })
    const s2 = await api.put(`/recordings/${ids.rec3}/summary`, { token: tokens.archivist, body: { summary: fx.summaries[1] } })
    run.check('档案员撰写一句话摘要', s1.code === 0 && s2.code === 0)
    const sByIv = await api.put(`/recordings/${ids.rec1}/summary`, { token: tokens.interviewerA, body: { summary: '采访员写摘要' } })
    run.check('采访员写摘要被拒(403)', sByIv.status === 403)
    const sByAdmin = await api.put(`/recordings/${ids.rec2}/summary`, { token: tokens.admin, body: { summary: '管理员补充摘要' } })
    run.check('管理员可写摘要', sByAdmin.code === 0)

    ids.markers = []
    const m1 = await api.post('/timeline-markers', { token: tokens.archivist, body: { project_id: ids.projectA, recording_id: ids.rec1, ...fx.markers[0] } })
    const m2 = await api.post('/timeline-markers', { token: tokens.archivist, body: { project_id: ids.projectA, recording_id: ids.rec1, ...fx.markers[1] } })
    const m3 = await api.post('/timeline-markers', { token: tokens.archivist, body: { project_id: ids.projectA, recording_id: ids.rec3, ...fx.markers[2] } })
    ids.markers = [m1.data?.id, m2.data?.id, m3.data?.id]
    run.check('档案员标注 3 个时间轴节点', ids.markers.every(Boolean))

    const mZero = await api.post('/timeline-markers', { token: tokens.archivist, body: { project_id: ids.projectA, recording_id: ids.rec2, timestamp_second: 0, label: '片头节点' } })
    run.check('0 秒处节点允许标注', mZero.code === 0)
    ids.markers.push(mZero.data?.id)

    const mByIv = await api.post('/timeline-markers', { token: tokens.interviewerA, body: { project_id: ids.projectA, recording_id: ids.rec1, timestamp_second: 1, label: '采访员标注' } })
    run.check('采访员标注节点被拒(403)', mByIv.status === 403)
    const mCross = await api.post('/timeline-markers', { token: tokens.archivist, body: { project_id: ids.projectB, recording_id: ids.rec1, timestamp_second: 3, label: '跨项目节点' } })
    run.check('节点挂到别的项目的录音被拒(400)', mCross.status === 400)

    const mEdit = await api.put(`/timeline-markers/${ids.markers[0]}`, { token: tokens.archivist, body: { label: '讲到四合院布局（修订）' } })
    run.check('档案员修订节点', mEdit.code === 0)
    const mEditByIv = await api.put(`/timeline-markers/${ids.markers[0]}`, { token: tokens.interviewerA, body: { label: '采访员改节点' } })
    run.check('采访员修订节点被拒(403)', mEditByIv.status === 403)
    const mDelByIv = await api.del(`/timeline-markers/${ids.markers[3]}`, { token: tokens.interviewerA })
    run.check('采访员删除节点被拒(403)', mDelByIv.status === 403)
    const mDel = await api.del(`/timeline-markers/${ids.markers[3]}`, { token: tokens.archivist })
    run.check('档案员删除节点', mDel.code === 0)
    ids.markers.pop()

    const list = await api.get(`/timeline-markers?project_id=${ids.projectA}`, { token: tokens.interviewerA })
    const ts = list.data.list.map((m) => m.timestamp_second)
    run.check('节点按时间戳排序且归属正确录音', ts.join(',') === [...ts].sort((a, b) => a - b).join(',') && list.data.list.every((m) => [ids.rec1, ids.rec3].includes(m.recording_id)))
  }

  // ---------- 归档只读 ----------
  run.section('归档后项目只读')
  {
    const complete = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.interviewerA, body: { status: 'completed' } })
    run.check('采访员标记项目完成', complete.code === 0)
    const archive = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.archivist, body: { status: 'archived' } })
    run.check('档案员归档项目', archive.code === 0 && archive.data.status === 'archived')

    const w1 = await api.put(`/projects/${ids.projectA}`, { token: tokens.interviewerA, body: { title: '归档后改名' } })
    run.check('归档后改项目资料被拒(409)', w1.status === 409)
    const w2 = await api.post(`/projects/${ids.projectA}/questions`, { token: tokens.interviewerA, body: { content: '归档后加问题' } })
    run.check('归档后加问题被拒(409)', w2.status === 409)
    const w3 = await api.post('/recordings', { token: tokens.interviewerA, body: { project_id: ids.projectA, question_id: ids.questions[2] } })
    run.check('归档后建录音被拒(409)', w3.status === 409)
    const w4 = await api.put(`/recordings/${ids.rec1}/summary`, { token: tokens.archivist, body: { summary: '归档后改摘要' } })
    run.check('归档后改摘要被拒(409)', w4.status === 409)
    const w5 = await api.post('/timeline-markers', { token: tokens.archivist, body: { project_id: ids.projectA, recording_id: ids.rec1, timestamp_second: 2, label: '归档后加节点' } })
    run.check('归档后加节点被拒(409)', w5.status === 409)
    const w6 = await api.put(`/projects/${ids.projectA}/status`, { token: tokens.archivist, body: { status: 'in_progress' } })
    run.check('归档后状态流转被拒(409)', w6.status === 409)
    const w7 = await api.del(`/questions/${ids.questions[2]}`, { token: tokens.interviewerA })
    run.check('归档后删问题被拒(409)', w7.status === 409)
    const w8 = await api.del(`/recordings/${ids.rec2}`, { token: tokens.interviewerA })
    run.check('归档后删录音被拒(409)', w8.status === 409)

    const r1 = await api.get(`/projects/${ids.projectA}`, { token: tokens.archivist })
    const r2 = await api.get(`/projects/${ids.projectA}/questions`, { token: tokens.interviewerA })
    const r3 = await api.get(`/recordings?project_id=${ids.projectA}`, { token: tokens.interviewerB })
    const r4 = await api.get(`/timeline-markers?project_id=${ids.projectA}`, { token: tokens.interviewerA })
    run.check('归档项目仍可读取（详情/提纲/片段/节点）', r1.code === 0 && r2.code === 0 && r3.code === 0 && r4.code === 0)
  }

  // ---------- 录音回放 ----------
  run.section('录音回放')
  {
    const play = await api.get(`/recordings/${ids.rec1}/audio`, { token: tokens.archivist })
    run.check('归档项目录音仍可回放(200)', play.status === 200)
    run.check('回放字节与上传完全一致', play.raw?.equals(wav))
    run.check('回放携带音频 Content-Type', (play.contentType || '').includes('audio/'))
    const anon = await api.get(`/recordings/${ids.rec1}/audio`)
    run.check('未认证回放被拒(401)', anon.status === 401)
  }

  // ---------- 未认证写操作 ----------
  run.section('未认证访问')
  {
    const anon = await api.post('/projects', { body: fx.projectA })
    run.check('未认证建档被拒(401)', anon.status === 401)
    const anonList = await api.get('/projects')
    run.check('未认证查列表被拒(401)', anonList.status === 401)
  }

  // ---------- 管理员审计 ----------
  run.section('管理员操作记录')
  {
    const auditsA = await api.get(`/audit-logs?page=1&page_size=100&username=${fx.users.interviewerA}`, { token: tokens.admin })
    const actions = (auditsA.data?.list || []).map((l) => l.action)
    run.check('审计覆盖采访员建档/状态/上传', ['project.create', 'project.status', 'recording.upload'].every((a) => actions.includes(a)))
    const auditsArc = await api.get(`/audit-logs?page=1&page_size=100&username=${fx.users.archivist}`, { token: tokens.admin })
    const actionsArc = (auditsArc.data?.list || []).map((l) => l.action)
    run.check('审计覆盖档案员摘要/节点/归档', ['recording.summary', 'marker.create', 'project.status'].every((a) => actionsArc.includes(a)))
    const auditForbidden = await api.get('/audit-logs', { token: tokens.archivist })
    run.check('档案员查看审计日志被拒(403)', auditForbidden.status === 403)
  }
}

main()
  .then(() => process.exit(run.finish() ? 0 : 1))
  .catch((e) => {
    console.error('测试执行异常:', e)
    run.check('测试执行异常', false, e.message)
    process.exit(run.finish() ? 0 : 1)
  })
