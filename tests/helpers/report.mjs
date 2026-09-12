/**
 * 断言收集与测试报告：控制台实时输出，结束后写 JSON + Markdown 报告。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'reports')

export class TestRun {
  constructor(name) {
    this.name = name
    this.results = []
    this.startedAt = new Date()
  }

  check(name, cond, extra = '') {
    this.results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) })
    console.log(`  ${cond ? '✔' : '✘'} ${name}${cond ? '' : ` ${extra}`}`)
  }

  section(title) {
    console.log(`\n[${title}]`)
  }

  get failed() {
    return this.results.filter((r) => !r.pass)
  }

  /** 汇总并写报告，返回是否全部通过。 */
  finish() {
    const finishedAt = new Date()
    const passed = this.results.length - this.failed.length
    const ok = this.failed.length === 0
    console.log(`\n== ${this.name}: ${passed} 通过, ${this.failed.length} 失败 ==`)
    if (!ok) this.failed.forEach((f) => console.log(`  - ${f.name}`))

    mkdirSync(REPORT_DIR, { recursive: true })
    const stamp = this.startedAt.toISOString().replace(/[:.]/g, '-')
    const summary = {
      name: this.name,
      ok,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      total: this.results.length,
      passed,
      failed: this.failed.length,
      results: this.results,
    }
    writeFileSync(join(REPORT_DIR, `${this.name}-${stamp}.json`), JSON.stringify(summary, null, 2))

    const lines = [
      `# 测试报告：${this.name}`,
      '',
      `- 结果：${ok ? '✅ 全部通过' : '❌ 存在失败'}（${passed}/${this.results.length}）`,
      `- 开始：${this.startedAt.toISOString()}`,
      `- 结束：${finishedAt.toISOString()}`,
      '',
      '| # | 断言 | 结果 |',
      '| --- | --- | --- |',
      ...this.results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.pass ? '✔' : `✘ ${r.extra}`} |`),
      '',
    ]
    writeFileSync(join(REPORT_DIR, `${this.name}-latest.md`), lines.join('\n'))
    console.log(`报告已写入 tests/reports/${this.name}-latest.md`)
    return ok
  }
}
