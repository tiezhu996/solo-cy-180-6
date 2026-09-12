/**
 * 测试数据固件：确定性的测试输入，可重复运行。
 * 每次运行用随机后缀隔离数据，同一环境可反复执行互不干扰。
 */

/** 生成 0.3 秒 8kHz 单声道 16bit PCM WAV（440Hz 正弦波），内容完全确定。 */
export function makeWav() {
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

/** 每次运行唯一的用户/项目命名，保证可重复运行。 */
export function makeFixture(suffix = Math.random().toString(36).slice(2, 8)) {
  return {
    suffix,
    password: 'test123456',
    admin: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin123456' },
    users: {
      interviewerA: `it_interviewer_a_${suffix}`,
      interviewerB: `it_interviewer_b_${suffix}`,
      archivist: `it_archivist_${suffix}`,
      escalate: `it_escalate_${suffix}`,
    },
    projectA: {
      title: `老兵口述史_${suffix}`,
      interviewee_name: '王建国',
      birth_year: 1935,
      background: '1953年参军，后转业至纺织厂',
    },
    projectB: {
      title: `乡村教师口述_${suffix}`,
      interviewee_name: '李秀兰',
      birth_year: 1942,
      background: '扎根乡村小学三十年',
    },
    questions: ['您小时候的家是什么样子？', '您还记得参军那天的情景吗？', '转业到工厂后最难忘的事？'],
    summaries: ['老人回忆了童年胡同里的四合院生活', '参军那天全村敲锣打鼓送行'],
    markers: [
      { timestamp_second: 5, label: '讲到四合院布局', note: '提到影壁墙' },
      { timestamp_second: 12, label: '回忆儿时玩伴' },
      { timestamp_second: 8, label: '全村送行场景' },
    ],
  }
}
