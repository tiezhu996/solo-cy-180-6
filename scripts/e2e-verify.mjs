#!/usr/bin/env node
/**
 * 口述历史采集工具端到端验证脚本。
 * 用三种角色走完「建档 → 提纲 → 录音问答 → 摘要/节点 → 归档 → 时间轴回放」，
 * 并验证越权、跨项目挂接、已归档写入均被拒绝。
 *
 * 用法: node scripts/e2e-verify.mjs [baseURL]   默认 http://127.0.0.1:9180/api/v1
 */

const BASE = process.argv[2] || 'http://127.0.0.1:9180/api/v1'

let passed = 0
let failed = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  ✘ ${name} ${extra}`)
  }
}

async function api(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const json = await res.json()
    return { status: res.status, ...json }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, raw: buf, contentType: ct }
}

const suffix = Math.random().toString(36).slice(2, 8)
const INTERVIEWER = `interviewer_${suffix}`
const INTERVIEWER2 = `interviewer2_${suffix}`
const ARCHIVIST = `archivist_${suffix}`
const PASSWORD = 'test123456'

// 生成 0.3 秒 8kHz 单声道 WAV（正弦波），作为测试录音。
function makeWav() {
  const rate = 8000
  const seconds = 0.3
  const n = Math.floor(rate * seconds)
  const dataSize = n * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2)
  }
  return buf
}

async function main() {
  console.log(`\n== E2E 验证 @ ${BASE} ==\n`)

  // ---------- 0. 健康检查 ----------
  console.log('[0] 服务健康检查')
  const health = await fetch(BASE.replace('/api/v1', '/healthz')).then((r) => r.json())
  check('healthz 返回 db=true', health?.data?.db === true)

  // ---------- 1. 注册与角色 ----------
  console.log('\n[1] 公开注册默认采访员，角色调整仅管理员')
  const reg1 = await api('POST', '/auth/register', { body: { username: INTERVIEWER, password: PASSWORD, display_name: '采访员甲' } })
  check('注册采访员成功', reg1.code === 0 && reg1.data.role === 'interviewer', JSON.stringify(reg1))

  const regEscalate = await api('POST', '/auth/register', { body: { username: `escalate_${suffix}`, password: PASSWORD, display_name: '提权尝试', role: 'admin' } })
  check('注册携带 role=admin 仍只能是采访员', regEscalate.code === 0 && regEscalate.data.role === 'interviewer')

  const reg2 = await api('POST', '/auth/register', { body: { username: INTERVIEWER2, password: PASSWORD, display_name: '采访员乙' } })
  check('注册第二名采访员', reg2.code === 0)
  const reg3 = await api('POST', '/auth/register', { body: { username: ARCHIVIST, password: PASSWORD, display_name: '档案员丙' } })
  check('注册未来档案员（默认仍是采访员）', reg3.code === 0 && reg3.data.role === 'interviewer')

  const adminLogin = await api('POST', '/auth/login', { body: { username: 'admin', password: 'admin123456' } })
  check('管理员登录', adminLogin.code === 0 && !!adminLogin.data.token)
  const admin = adminLogin.data.token

  const login1 = await api('POST', '/auth/login', { body: { username: INTERVIEWER, password: PASSWORD } })
  const login2 = await api('POST', '/auth/login', { body: { username: INTERVIEWER2, password: PASSWORD } })
  const login3 = await api('POST', '/auth/login', { body: { username: ARCHIVIST, password: PASSWORD } })
  const iv1 = login1.data.token
  const iv2 = login2.data.token
  let arc = login3.data.token
  check('三名用户登录成功', !!iv1 && !!iv2 && !!arc)

  const users1 = await api('GET', '/users?page=1&page_size=100', { token: admin })
  const archivistUser = users1.data.list.find((u) => u.username === ARCHIVIST)
  const promote = await api('PUT', `/users/${archivistUser.id}/role`, { token: admin, body: { role: 'archivist' } })
  check('管理员调整角色为档案员', promote.code === 0)
  const relogin = await api('POST', '/auth/login', { body: { username: ARCHIVIST, password: PASSWORD } })
  arc = relogin.data.token
  check('档案员重新登录获得新角色', relogin.data.user.role === 'archivist')

  const usersForbidden = await api('GET', '/users', { token: iv1 })
  check('采访员查看账号列表被拒(403)', usersForbidden.status === 403)
  const auditForbidden = await api('GET', '/audit-logs', { token: arc })
  check('档案员查看审计日志被拒(403)', auditForbidden.status === 403)
  const roleBySelf = await api('PUT', `/users/${archivistUser.id}/role`, { token: iv1, body: { role: 'admin' } })
  check('采访员调整角色被拒(403)', roleBySelf.status === 403)

  // ---------- 2. 采访员建档 ----------
  console.log('\n[2] 采访员建档（项目 + 受访者资料）')
  const proj = await api('POST', '/projects', {
    token: iv1,
    body: { title: '老兵口述史', interviewee_name: '王建国', birth_year: 1935, background: '1953年参军，后转业至纺织厂' },
  })
  check('采访员创建项目成功', proj.code === 0 && proj.data.status === 'draft', JSON.stringify(proj))
  const pid = proj.data.id

  const projByArchivist = await api('POST', '/projects', {
    token: arc,
    body: { title: '越权项目', interviewee_name: '张三', birth_year: 1950 },
  })
  check('档案员创建项目被拒(403)', projByArchivist.status === 403)

  const proj2 = await api('POST', '/projects', {
    token: iv2,
    body: { title: '乙的项目', interviewee_name: '李秀兰', birth_year: 1942, background: '乡村教师' },
  })
  check('采访员乙创建自己的项目', proj2.code === 0)
  const pid2 = proj2.data.id

  const updateOther = await api('PUT', `/projects/${pid}`, { token: iv2, body: { title: '篡改标题' } })
  check('采访员乙修改甲的项目被拒(403)', updateOther.status === 403)

  const start = await api('PUT', `/projects/${pid}/status`, { token: iv1, body: { status: 'in_progress' } })
  check('项目流转到进行中', start.code === 0 && start.data.status === 'in_progress')
  const badTransition = await api('PUT', `/projects/${pid}/status`, { token: iv1, body: { status: 'draft' } })
  check('进行中回退草稿被状态机拒绝(409)', badTransition.status === 409)

  // ---------- 3. 采访提纲 ----------
  console.log('\n[3] 采访提纲（问题清单）')
  const q1 = await api('POST', `/projects/${pid}/questions`, { token: iv1, body: { content: '您小时候的家是什么样子？', sort_order: 0 } })
  const q2 = await api('POST', `/projects/${pid}/questions`, { token: iv1, body: { content: '您还记得参军那天的情景吗？', sort_order: 1 } })
  const q3 = await api('POST', `/projects/${pid}/questions`, { token: iv1, body: { content: '转业到工厂后最难忘的事？', sort_order: 2 } })
  check('采访员添加 3 个提纲问题', q1.code === 0 && q2.code === 0 && q3.code === 0)
  const [qid1, qid2, qid3] = [q1.data.id, q2.data.id, q3.data.id]

  const qByArchivist = await api('POST', `/projects/${pid}/questions`, { token: arc, body: { content: '档案员试图加问题' } })
  check('档案员添加问题被拒(403)', qByArchivist.status === 403)
  const qByOther = await api('POST', `/projects/${pid}/questions`, { token: iv2, body: { content: '乙给甲的项目加问题' } })
  check('非负责人采访员添加问题被拒(403)', qByOther.status === 403)
  const qOtherProj = await api('POST', `/projects/${pid2}/questions`, { token: iv2, body: { content: '乙项目的第一个问题', sort_order: 0 } })
  check('采访员乙在自己项目添加问题', qOtherProj.code === 0)
  const qidOther = qOtherProj.data.id

  // ---------- 4. 录音问答 ----------
  console.log('\n[4] 录音问答（录音落在对应问题上）')
  const wav = makeWav()
  async function recordOnQuestion(token, projectId, questionId, seconds) {
    const rec = await api('POST', '/recordings', { token, body: { project_id: projectId, question_id: questionId, duration_seconds: seconds } })
    if (rec.code !== 0) return rec
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }, `rec_${questionId}.wav`), `rec_${questionId}.wav`)
    form.append('duration_seconds', String(seconds))
    const up = await api('POST', `/recordings/${rec.data.id}/audio`, { token, form })
    return { ...rec, upload: up }
  }

  const r1 = await recordOnQuestion(iv1, pid, qid1, 18)
  check('问题1 录音创建并上传音频', r1.code === 0 && r1.upload?.code === 0 && r1.upload?.data?.status === 'ready', JSON.stringify(r1.upload || r1))
  const rid1 = r1.data.id
  check('录音自动关联到对应问题', r1.upload.data.question_id === qid1 && r1.upload.data.project_id === pid && !!r1.upload.data.audio_key)

  const r2 = await recordOnQuestion(iv1, pid, qid2, 25)
  const r3 = await recordOnQuestion(iv1, pid, qid1, 12)
  check('问题2/问题1 第二段录音完成', r2.upload?.code === 0 && r3.upload?.code === 0)
  const [rid2, rid3] = [r2.data.id, r3.data.id]

  const crossRec = await api('POST', '/recordings', { token: iv2, body: { project_id: pid2, question_id: qid1 } })
  check('录音挂到别的项目的问题被拒(400)', crossRec.status === 400)
  const recByArchivist = await api('POST', '/recordings', { token: arc, body: { project_id: pid, question_id: qid1 } })
  check('档案员创建录音被拒(403)', recByArchivist.status === 403)
  const recByOther = await api('POST', '/recordings', { token: iv2, body: { project_id: pid, question_id: qid1 } })
  check('非负责人创建录音被拒(403)', recByOther.status === 403)

  // ---------- 5. 档案员整理摘要与节点 ----------
  console.log('\n[5] 档案员整理摘要与时间轴节点')
  const sum1 = await api('PUT', `/recordings/${rid1}/summary`, { token: arc, body: { summary: '老人回忆了童年胡同里的四合院生活' } })
  const sum2 = await api('PUT', `/recordings/${rid2}/summary`, { token: arc, body: { summary: '参军那天全村敲锣打鼓送行' } })
  check('档案员撰写一句话摘要', sum1.code === 0 && sum2.code === 0)
  const sumByIv = await api('PUT', `/recordings/${rid1}/summary`, { token: iv1, body: { summary: '采访员试图写摘要' } })
  check('采访员写摘要被拒(403)', sumByIv.status === 403)

  const m1 = await api('POST', '/timeline-markers', { token: arc, body: { project_id: pid, recording_id: rid1, timestamp_second: 5, label: '讲到四合院布局', note: '提到影壁墙' } })
  const m2 = await api('POST', '/timeline-markers', { token: arc, body: { project_id: pid, recording_id: rid1, timestamp_second: 12, label: '回忆儿时玩伴' } })
  const m3 = await api('POST', '/timeline-markers', { token: arc, body: { project_id: pid, recording_id: rid2, timestamp_second: 8, label: '全村送行场景' } })
  check('档案员标注 3 个时间轴节点', m1.code === 0 && m2.code === 0 && m3.code === 0)
  const mByIv = await api('POST', '/timeline-markers', { token: iv1, body: { project_id: pid, recording_id: rid1, timestamp_second: 1, label: '采访员试图标注' } })
  check('采访员标注节点被拒(403)', mByIv.status === 403)
  const crossMarker = await api('POST', '/timeline-markers', { token: arc, body: { project_id: pid2, recording_id: rid1, timestamp_second: 3, label: '跨项目节点' } })
  check('节点挂到别的项目的录音被拒(400)', crossMarker.status === 400)

  // ---------- 6. 完成并归档 ----------
  console.log('\n[6] 完成采访并归档')
  const complete = await api('PUT', `/projects/${pid}/status`, { token: iv1, body: { status: 'completed' } })
  check('采访员标记项目完成', complete.code === 0 && complete.data.status === 'completed')
  const archive = await api('PUT', `/projects/${pid}/status`, { token: arc, body: { status: 'archived' } })
  check('档案员归档项目', archive.code === 0 && archive.data.status === 'archived')

  console.log('\n[7] 已归档项目写入一律被拒')
  const w1 = await api('PUT', `/projects/${pid}`, { token: iv1, body: { title: '归档后改名' } })
  check('归档后改项目资料被拒(409)', w1.status === 409)
  const w2 = await api('POST', `/projects/${pid}/questions`, { token: iv1, body: { content: '归档后加问题' } })
  check('归档后加问题被拒(409)', w2.status === 409)
  const w3 = await api('POST', '/recordings', { token: iv1, body: { project_id: pid, question_id: qid3 } })
  check('归档后建录音被拒(409)', w3.status === 409)
  const w4 = await api('PUT', `/recordings/${rid1}/summary`, { token: arc, body: { summary: '归档后改摘要' } })
  check('归档后改摘要被拒(409)', w4.status === 409)
  const w5 = await api('POST', '/timeline-markers', { token: arc, body: { project_id: pid, recording_id: rid1, timestamp_second: 2, label: '归档后加节点' } })
  check('归档后加节点被拒(409)', w5.status === 409)
  const w6 = await api('PUT', `/projects/${pid}/status`, { token: arc, body: { status: 'in_progress' } })
  check('归档后状态流转被拒(409)', w6.status === 409)
  const w7 = await api('DELETE', `/questions/${qid3}`, { token: iv1 })
  check('归档后删问题被拒(409)', w7.status === 409)

  // ---------- 8. 时间轴回放 ----------
  console.log('\n[8] 项目详情时间轴回放')
  const timeline = await api('GET', `/recordings?project_id=${pid}`, { token: arc })
  const ids = timeline.data.list.map((r) => r.id)
  check('片段按时间顺序排列', ids.join(',') === [rid1, rid3, rid2].sort((a, b) => a - b).join(','), ids.join(','))
  check('片段携带问题与摘要', timeline.data.list.every((r) => r.question_id > 0 && (r.summary !== undefined)))
  const markers = await api('GET', `/timeline-markers?project_id=${pid}`, { token: iv1 })
  const ts = markers.data.list.map((m) => m.timestamp_second)
  check('节点按时间戳排序且归属正确录音', ts.join(',') === [...ts].sort((a, b) => a - b).join(',') && markers.data.list.every((m) => [rid1, rid2].includes(m.recording_id)))
  const play = await api('GET', `/recordings/${rid1}/audio`, { token: arc })
  check('录音可回放(200 + 音频流)', play.status === 200 && play.raw?.length === wav.length, `len=${play.raw?.length}`)
  check('回放内容与上传一致', play.raw?.equals(wav))
  const playNoAuth = await fetch(`${BASE}/recordings/${rid1}/audio`)
  check('未认证访问录音被拒(401)', playNoAuth.status === 401)

  // ---------- 9. 管理员视角 ----------
  console.log('\n[9] 管理员查看账号与操作记录')
  const users = await api('GET', '/users?page=1&page_size=100', { token: admin })
  check('账号列表包含新注册用户', [INTERVIEWER, INTERVIEWER2, ARCHIVIST].every((n) => users.data.list.some((u) => u.username === n)))
  const audits = await api('GET', `/audit-logs?page=1&page_size=100&username=${INTERVIEWER}`, { token: admin })
  const actions = audits.data.list.map((l) => l.action)
  check('审计记录覆盖建档/状态/上传', ['project.create', 'project.status', 'recording.upload'].every((a) => actions.includes(a)), actions.join(','))
  const auditsArc = await api('GET', `/audit-logs?page=1&page_size=100&username=${ARCHIVIST}`, { token: admin })
  const actionsArc = auditsArc.data.list.map((l) => l.action)
  check('审计记录覆盖摘要/节点/归档', ['recording.summary', 'marker.create', 'project.status'].every((a) => actionsArc.includes(a)), actionsArc.join(','))

  // ---------- 汇总 ----------
  console.log(`\n== 结果: ${passed} 通过, ${failed} 失败 ==`)
  if (failed > 0) {
    console.log('失败项:')
    failures.forEach((f) => console.log(`  - ${f}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('E2E 脚本异常:', e)
  process.exit(1)
})
