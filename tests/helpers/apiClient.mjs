/**
 * 极简 API 客户端：封装 fetch，统一返回 { status, code, message, data }。
 */
export class ApiClient {
  constructor(base) {
    this.base = base.replace(/\/$/, '')
  }

  async request(method, path, { token, body, form } = {}) {
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    let payload
    if (form) {
      payload = form
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(`${this.base}${path}`, { method, headers, body: payload })
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      const json = await res.json()
      return { status: res.status, code: json.code, message: json.message, data: json.data }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, raw: buf, contentType: ct }
  }

  get(path, opts) { return this.request('GET', path, opts) }
  post(path, opts) { return this.request('POST', path, opts) }
  put(path, opts) { return this.request('PUT', path, opts) }
  del(path, opts) { return this.request('DELETE', path, opts) }

  /** 创建录音记录并上传音频，返回 { rec, up }。 */
  async recordWithAudio(token, projectId, questionId, seconds, wav) {
    const rec = await this.post('/recordings', { token, body: { project_id: projectId, question_id: questionId, duration_seconds: seconds } })
    if (rec.code !== 0) return { rec }
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }, `rec_${questionId}.wav`), `rec_${questionId}.wav`)
    form.append('duration_seconds', String(seconds))
    const up = await this.post(`/recordings/${rec.data.id}/audio`, { token, form })
    return { rec, up }
  }
}
