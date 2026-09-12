/**
 * 浏览器端到端测试：headless Chromium 走通三种角色并检查录音播放。
 *
 * 覆盖：注册/登录、采访员建档→提纲→录音、档案员摘要/节点/归档、
 *       管理员账号与审计、时间轴回放播放。
 *
 * 运行：node tests/browser/roles.e2e.mjs
 * 环境变量：
 *   FRONTEND_BASE  前端地址，默认 http://127.0.0.1:8180
 *   API_BASE       后端地址，默认 http://127.0.0.1:9180/api/v1
 *   CHROMIUM_PATH  浏览器可执行文件路径（默认自动探测 playwright 缓存）
 *   ADMIN_PASSWORD 管理员密码，默认 admin123456
 * 每次运行生成随机后缀的测试数据，可重复执行。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright-core'
import { makeFixture } from '../helpers/fixtures.mjs'
import { TestRun } from '../helpers/report.mjs'

const FRONTEND_BASE = process.env.FRONTEND_BASE || 'http://127.0.0.1:8180'
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:9180/api/v1'
const fx = makeFixture()
const PTITLE = `浏览器验证项目_${fx.suffix}`
const run = new TestRun('browser-e2e')

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const cache = join(homedir(), '.cache/ms-playwright')
  const candidates = [
    'chromium_headless_shell-1148/chrome-linux/headless_shell',
    'chromium-1148/chrome-linux/chrome',
  ]
  for (const rel of candidates) {
    const p = join(cache, rel)
    if (existsSync(p)) return p
  }
  throw new Error(`未找到 Chromium，请设置 CHROMIUM_PATH 或执行 npx playwright-core install chromium-headless-shell`)
}

async function newPage(browser) {
  const ctx = await browser.newContext({ permissions: ['microphone'] })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  return { ctx, page }
}

async function uiLogin(page, username, password = fx.password) {
  await page.goto(`${FRONTEND_BASE}/#/login`)
  await page.fill('input[placeholder="用户名"]', username)
  await page.fill('input[placeholder="密码"]', password)
  await page.click('button:has-text("登 录")')
  await page.waitForSelector('.topbar .user-name', { timeout: 8000 })
}

async function uiLogout(page) {
  await page.click('button:has-text("退出")')
  await page.waitForSelector('.login-card', { timeout: 8000 })
}

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return res.json()
}

async function main() {
  console.log(`浏览器测试 @ ${FRONTEND_BASE}（数据后缀 ${fx.suffix}）`)
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })
  try {
    // ---------- 采访员：注册 → 建档 → 提纲 → 录音 ----------
    run.section('采访员：注册、建档、提纲、录音')
    const ivName = `ui_interviewer_${fx.suffix}`
    {
      const { ctx, page } = await newPage(browser)
      await page.goto(`${FRONTEND_BASE}/#/login`)
      run.check('登录页渲染', await page.isVisible('.login-title'))
      await page.click('button:has-text("注册")')
      await page.fill('input[placeholder="您的昵称"]', '浏览器采访员')
      await page.fill('input[placeholder="用户名"]', ivName)
      await page.fill('input[placeholder="密码"]', fx.password)
      await page.click('button:has-text("注册并登录")')
      await page.waitForSelector('.topbar .user-role', { timeout: 8000 })
      run.check('注册后自动登录且角色为采访员', (await page.textContent('.topbar .user-role'))?.includes('采访员'))
      run.check('采访员导航无账号管理/审计入口', !(await page.isVisible('text=账号管理')) && !(await page.isVisible('text=审计日志')))

      await page.click('button:has-text("＋ 新建采访项目")')
      const inputs = page.locator('.modal input')
      await inputs.nth(0).fill(PTITLE)
      await inputs.nth(1).fill('张奶奶')
      await inputs.nth(2).fill('1940')
      await page.fill('.modal textarea', '浏览器端建档验证')
      await page.click('.modal button:has-text("创建项目")')
      await page.waitForSelector(`text=${PTITLE}`, { timeout: 8000 })
      run.check('项目列表出现新项目', await page.isVisible(`text=${PTITLE}`))

      await page.click(`a:has-text("${PTITLE}")`)
      await page.waitForSelector('text=项目信息')
      run.check('详情页展示受访者资料', (await page.isVisible('text=张奶奶')) && (await page.isVisible('text=1940')))

      await page.click('button:has-text("开始采访")')
      await page.waitForSelector('text=进行中')
      run.check('项目状态流转为进行中', await page.isVisible('text=进行中'))

      for (const q of ['您出生在哪里？', '讲讲您上学时的故事']) {
        await page.fill('input[placeholder="输入新的采访问题"]', q)
        await page.click('button:has-text("添加问题")')
        await page.waitForSelector(`text=${q}`)
      }
      run.check('提纲问题添加成功', await page.isVisible('text=您出生在哪里？'))

      await page.click('a:has-text("前往采访工作台")')
      await page.waitForSelector('.question-tab')
      await page.click('.question-tab >> nth=0')
      await page.waitForSelector('button:has-text("⏺ 开始录音")')
      run.check('采访员看不到摘要编辑框', !(await page.isVisible('button:has-text("保存摘要")')))
      await page.click('button:has-text("⏺ 开始录音")')
      await page.waitForSelector('text=正在录音', { timeout: 5000 })
      await page.waitForTimeout(2500)
      await page.click('button:has-text("⏹ 停止并保存")')
      await page.waitForSelector('text=本问题已录片段（1）', { timeout: 15000 })
      run.check('浏览器录音上传并关联到问题', await page.isVisible('text=本问题已录片段（1）'))
      run.check('录音面板出现播放器', await page.isVisible('.audio-player button:has-text("播放")'))
      await uiLogout(page)
      await ctx.close()
    }

    // ---------- 档案员：摘要 → 节点 → 归档 ----------
    run.section('档案员：摘要、节点、归档')
    const arcName = `ui_archivist_${fx.suffix}`
    {
      await apiPost('/auth/register', { username: arcName, password: fx.password, display_name: '浏览器档案员' })
      const adminLogin = await apiPost('/auth/login', { username: fx.admin.username, password: fx.admin.password })
      const users = await fetch(`${API_BASE}/users?page=1&page_size=300`, { headers: { Authorization: `Bearer ${adminLogin.data.token}` } }).then((r) => r.json())
      const arcUser = users.data.list.find((u) => u.username === arcName)
      await fetch(`${API_BASE}/users/${arcUser.id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminLogin.data.token}` },
        body: JSON.stringify({ role: 'archivist' }),
      })
      run.check('档案员账号经管理员提权就绪', !!arcUser)

      const { ctx, page } = await newPage(browser)
      await uiLogin(page, arcName)
      run.check('档案员看不到新建项目按钮', !(await page.isVisible('button:has-text("＋ 新建采访项目")')))

      await page.click(`a:has-text("${PTITLE}")`)
      await page.waitForSelector('text=时间线 · 采访片段')
      run.check('详情页时间线展示片段', await page.isVisible('.timeline-item'))
      run.check('片段带播放器可回放', await page.isVisible('.audio-player button:has-text("播放")'))

      await page.fill('.summary-edit input', '老人讲述出生地的小山村')
      await page.click('button:has-text("保存摘要")')
      await page.waitForSelector('text=老人讲述出生地的小山村', { timeout: 8000 })
      run.check('摘要保存并展示在时间线', await page.isVisible('text=老人讲述出生地的小山村'))

      await page.fill('input[placeholder="标注关键节点，如：回忆童年故居"]', '提到村口老槐树')
      await page.click('button:has-text("＋ 标注节点")')
      await page.waitForSelector('text=提到村口老槐树', { timeout: 8000 })
      run.check('时间轴节点标注成功', await page.isVisible('text=提到村口老槐树'))

      await page.click('button:has-text("标记为已完成")')
      await page.waitForSelector('text=已完成')
      await page.click('button:has-text("归档项目")')
      await page.waitForSelector('text=已归档')
      run.check('项目归档完成', await page.isVisible('text=已归档'))
      run.check('归档后不再显示添加问题表单', !(await page.isVisible('input[placeholder="输入新的采访问题"]')))
      run.check('归档后不再显示节点标注表单', !(await page.isVisible('input[placeholder="标注关键节点，如：回忆童年故居"]')))
      await uiLogout(page)
      await ctx.close()
    }

    // ---------- 管理员：账号与审计 ----------
    run.section('管理员：账号与审计')
    {
      const { ctx, page } = await newPage(browser)
      await uiLogin(page, fx.admin.username, fx.admin.password)
      run.check('管理员导航含账号管理与审计日志', await page.isVisible('text=账号管理'))

      await page.click('text=账号管理')
      await page.waitForSelector('text=注册时间')
      run.check('账号列表展示新注册用户', (await page.isVisible(`text=${ivName}`)) && (await page.isVisible(`text=${arcName}`)))
      run.check('角色下拉可调整', (await page.locator('table select').count()) > 0)

      await page.click('text=审计日志')
      await page.waitForSelector('text=操作人')
      const body = await page.textContent('table')
      run.check(
        '审计日志含建档/录音/摘要/节点记录',
        body.includes('project.create') && body.includes('recording.upload') && body.includes('recording.summary') && body.includes('marker.create'),
      )
      await ctx.close()
    }

    // ---------- 时间轴回放 ----------
    run.section('时间轴回放播放检查')
    {
      const { ctx, page } = await newPage(browser)
      await uiLogin(page, ivName)
      await page.click(`a:has-text("${PTITLE}")`)
      await page.waitForSelector('.timeline-item')
      run.check('时间线展示采访片段', (await page.locator('.timeline-item').count()) >= 1)
      const btn = page.locator('.audio-player button').first()
      await btn.click()
      await page.waitForTimeout(1000)
      const playing = await page.evaluate(() => {
        const a = document.querySelector('.audio-player audio')
        return a ? !a.paused && a.currentTime > 0 : false
      })
      run.check('点击播放后音频进度推进', playing)
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
}

main()
  .then(() => process.exit(run.finish() ? 0 : 1))
  .catch((e) => {
    console.error('测试执行异常:', e)
    run.check('测试执行异常', false, e.message)
    process.exit(run.finish() ? 0 : 1)
  })
