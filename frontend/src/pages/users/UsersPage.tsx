// 账号管理页（仅管理员）：查看账号、调整角色、删除账号。
import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import DataTable from '../../components/DataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePagination } from '../../hooks/usePagination'
import { deleteUser, listUsers, updateUserRole } from '../../api/user'
import { ROLE_ADMIN, ROLE_OPTIONS, ROLE_TEXT } from '../../constants'
import { formatDateTime } from '../../utils/format'
import { useAuthStore } from '../../stores/authStore'
import type { User } from '../../api/types'

export default function UsersPage() {
  useAuth([ROLE_ADMIN])
  const { user: me } = useAuthStore()
  const { page, pageSize, total, setTotal, setPage } = usePagination(1, 20)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listUsers({ page, page_size: pageSize })
      setUsers(res.list)
      setTotal(res.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : '账号列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, setTotal])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const notify = (msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 3000)
  }

  const changeRole = async (u: User, role: string) => {
    try {
      await updateUserRole(u.id, role)
      notify(`已将 ${u.username} 的角色调整为${ROLE_TEXT[role] || role}`)
      fetchUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : '角色调整失败')
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>账号管理</h2>
      </div>
      {message && <div className="toast success">{message}</div>}
      {error && <div className="toast error">{error}</div>}
      <DataTable<User>
        loading={loading}
        rows={users}
        rowKey={(u) => u.id}
        columns={[
          { key: 'id', title: 'ID', render: (u) => u.id },
          { key: 'username', title: '用户名', render: (u) => u.username },
          { key: 'display_name', title: '昵称', render: (u) => u.display_name || '-' },
          { key: 'email', title: '邮箱', render: (u) => u.email || '-' },
          {
            key: 'role',
            title: '角色',
            render: (u) => (
              <select
                value={u.role}
                disabled={u.id === me?.id}
                onChange={(e) => changeRole(u, e.target.value)}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ),
          },
          { key: 'created_at', title: '注册时间', render: (u) => formatDateTime(u.created_at) },
          {
            key: 'actions',
            title: '操作',
            render: (u) => (
              <ConfirmDialog
                title="删除账号"
                message={`确定删除账号「${u.username}」吗？`}
                danger
                confirmText="删除"
                onConfirm={async () => {
                  await deleteUser(u.id)
                  notify(`账号 ${u.username} 已删除`)
                  fetchUsers()
                }}
              >
                <button className="btn btn-danger btn-small" disabled={u.id === me?.id || u.role === ROLE_ADMIN}>
                  删除
                </button>
              </ConfirmDialog>
            ),
          },
        ]}
        emptyText="暂无账号"
      />
      <div className="pagination">
        <button className="btn btn-plain btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>
          第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页，共 {total} 条
        </span>
        <button className="btn btn-plain btn-small" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  )
}
