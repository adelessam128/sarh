import { useEffect, useRef, useState, useTransition } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CreateOrderModal } from './CreateOrderModal'
import { LoginModal } from './LoginModal'
import './App.css'

interface User {
  id: number
  email: string
  name: string
  role: 'ADMIN' | 'AGENT'
}

interface OrderItem {
  productName: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

interface Order {
  id: number
  customerName: string
  customerEmail: string
  amount: number
  status: 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'
  items?: OrderItem[]
  createdAt: string
  updatedAt: string
}

interface OrdersResponse {
  items: Order[]
  pagination: {
    page: number
    pageSize: number
    totalCount: number
    totalPages: number
  }
}

interface HealthResponse {
  status: string
  message: string
  database: {
    type: string
    status: string
    ordersCount: number
  }
}

const STATUS_OPTIONS = ['ALL', 'PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('sarh_user')
    return saved ? JSON.parse(saved) : null
  })
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('sarh_token')
  })

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Filters & Pagination State
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState<string>('ALL')
  const [sortBy, setSortBy] = useState<'createdAt' | 'amount' | 'customerName'>('createdAt')
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('DESC')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false)

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset to page 1 on new search
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Handle Successful Login from LoginModal
  const handleLoginSuccess = (newToken: string, user: User) => {
    localStorage.setItem('sarh_token', newToken)
    localStorage.setItem('sarh_user', JSON.stringify(user))
    setToken(newToken)
    setCurrentUser(user)
  }

  // Handle Logout
  const handleLogout = () => {
    localStorage.removeItem('sarh_token')
    localStorage.removeItem('sarh_user')
    setToken(null)
    setCurrentUser(null)
  }

  // Handle Order Cancellation (Both Agents and Admins)
  const handleCancelOrder = async (orderId: number) => {
    if (!window.confirm(`Are you sure you want to cancel order #${orderId}?`)) return
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel order')
      }
      alert(`Order #${orderId} cancelled successfully!`)
      // Update local status
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'CANCELLED' } : o))
      )
    } catch (err: unknown) {
      alert(`Cancel error: ${(err as Error).message}`)
    }
  }

  // Handle Order Deletion (Strictly ADMIN Only)
  const handleDeleteOrder = async (orderId: number) => {
    if (!window.confirm(`Are you sure you want to permanently delete order #${orderId}?`)) return
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete order')
      }
      alert(`Order #${orderId} deleted successfully!`)
      // Refresh list
      setOrders((prev) => prev.filter((o) => o.id !== orderId))
      setTotalCount((c) => Math.max(0, c - 1))
      checkHealth()
    } catch (err: unknown) {
      alert(`Delete error: ${(err as Error).message}`)
    }
  }

  // Fetch Health
  const checkHealth = async () => {
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const data = await res.json()
        setHealth(data)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    checkHealth()
  }, [])

  // Fetch Orders via Stored Procedure
  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDir,
    })

    if (debouncedSearch.trim()) {
      params.set('search', debouncedSearch.trim())
    }
    if (status !== 'ALL') {
      params.set('status', status)
    }

    // If not logged in, prompt user to log in
    if (!token) {
      setOrders([])
      setLoading(false)
      return
    }

    fetch(`/api/orders?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `HTTP ${res.status}`)
        }
        return res.json() as Promise<OrdersResponse>
      })
      .then((data) => {
        if (!ignore) {
          startTransition(() => {
            setOrders(data.items)
            setTotalCount(data.pagination.totalCount)
            setTotalPages(data.pagination.totalPages)
            setLoading(false)
          })
        }
      })
      .catch((err: Error) => {
        if (!ignore) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [debouncedSearch, status, sortBy, sortDir, page, pageSize, token])

  // Trigger Seeding 50,000 records
  // const handleSeed = async () => {
  //   try {
  //     setSeeding(true)
  //     const res = await fetch('/api/orders/seed', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ count: 50000 })
  //     })
  //     if (!res.ok) throw new Error('Seeding failed')
  //     alert('Seeding 50,000 orders initiated in background! Check terminal or refresh health.')
  //     setTimeout(checkHealth, 3000)
  //   } catch (err: unknown) {
  //     alert((err as Error).message)
  //   } finally {
  //     setSeeding(false)
  //   }
  // }

  // Virtualizer Setup for the Table Container
  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  const getStatusBadgeStyle = (st: string) => {
    switch (st) {
      case 'DELIVERED':
        return { backgroundColor: '#dcfce7', color: '#166534' }
      case 'SHIPPED':
        return { backgroundColor: '#e0f2fe', color: '#0369a1' }
      case 'PROCESSING':
        return { backgroundColor: '#fef3c7', color: '#92400e' }
      case 'CANCELLED':
        return { backgroundColor: '#fee2e2', color: '#991b1b' }
      default:
        return { backgroundColor: '#f1f5f9', color: '#475569' }
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Orders Management</h1>
        </div>

        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {/* User Profile / Auth State Badge */}
          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#f8fafc', padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                  {currentUser.name}{' '}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      backgroundColor: currentUser.role === 'ADMIN' ? '#fee2e2' : '#e0f2fe',
                      color: currentUser.role === 'ADMIN' ? '#991b1b' : '#0369a1',
                      marginLeft: 4
                    }}
                  >
                    {currentUser.role}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{currentUser.email}</div>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#fff',
                  color: '#475569',
                  cursor: 'pointer'
                }}
              >
                Log Out
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>Not signed in</span>
              <button
                onClick={() => setIsLoginModalOpen(true)}
                style={{
                  fontSize: 13,
                  padding: '5px 14px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#0284c7',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Sign In
              </button>
            </div>
          )}

          <div style={{ fontSize: 13, color: '#334155' }}>
            DB: <strong>{health?.database.status || 'Checking...'}</strong>
            {health?.database.ordersCount !== undefined && ` (${health.database.ordersCount.toLocaleString()} total rows)`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              disabled={!token}
              title={!token ? 'Please log in to create orders' : ''}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 6,
                border: 'none',
                backgroundColor: token ? '#0284c7' : '#94a3b8',
                color: '#fff',
                cursor: token ? 'pointer' : 'not-allowed'
              }}
            >
              + Create Order
            </button>
            {/* <button
              onClick={handleSeed}
              disabled={seeding}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                backgroundColor: '#f8fafc',
                cursor: 'pointer'
              }}
            >
              {seeding ? 'Seeding...' : '⚡ Seed 50,000 Orders'}
            </button> */}
          </div>
        </div>
      </header>

      {/* Filter and Control Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          padding: 16,
          backgroundColor: '#f8fafc',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          marginBottom: 16
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Search (Name / Email)
          </label>
          <input
            type="text"
            placeholder="Type customer name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Filter Status
          </label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a' }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt} style={{ color: '#0f172a', backgroundColor: '#fff' }}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Sort By
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'createdAt' | 'amount' | 'customerName')}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a' }}
          >
            <option value="createdAt" style={{ color: '#0f172a', backgroundColor: '#fff' }}>Date (createdAt)</option>
            <option value="amount" style={{ color: '#0f172a', backgroundColor: '#fff' }}>Amount ($)</option>
            <option value="customerName" style={{ color: '#0f172a', backgroundColor: '#fff' }}>Customer Name</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Sort Direction
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setSortDir('DESC')}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                backgroundColor: sortDir === 'DESC' ? '#0284c7' : '#fff',
                color: sortDir === 'DESC' ? '#fff' : '#334155',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              DESC ↓
            </button>
            <button
              onClick={() => setSortDir('ASC')}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                backgroundColor: sortDir === 'ASC' ? '#0284c7' : '#fff',
                color: sortDir === 'ASC' ? '#fff' : '#334155',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              ASC ↑
            </button>
          </div>
        </div>
      </div>

      {/* Meta Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13, color: '#64748b' }}>
        <div>
          {loading || isPending ? (
            <span style={{ color: '#0284c7', fontWeight: 600 }}>Executing Stored Procedure...</span>
          ) : (
            <span>
              Matching Orders: <strong>{totalCount.toLocaleString()}</strong> | Showing {orders.length} in current page
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label>Rows per page:</label>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a' }}
          >
            <option value={50} style={{ color: '#0f172a', backgroundColor: '#fff' }}>50</option>
            <option value={100} style={{ color: '#0f172a', backgroundColor: '#fff' }}>100</option>
            <option value={200} style={{ color: '#0f172a', backgroundColor: '#fff' }}>200</option>
          </select>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, marginBottom: 12 }}>
          {error}
          <div style={{ fontSize: 12, marginTop: 4, color: '#7f1d1d' }}>
            Ensure your database migrations are applied: <code>npm run prisma:migrate</code>
          </div>
        </div>
      )}

      {/* Virtualized Table Container */}
      <div
        ref={parentRef}
        style={{
          height: '520px',
          overflow: 'auto',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          backgroundColor: '#fff',
          position: 'relative'
        }}
      >
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            display: 'grid',
            gridTemplateColumns: '70px 1.2fr 1.5fr 100px 110px 1.8fr 150px 140px',
            backgroundColor: '#f1f5f9',
            borderBottom: '2px solid #cbd5e1',
            padding: '12px 16px',
            fontWeight: 600,
            fontSize: 13,
            color: '#334155'
          }}
        >
          <div>ID</div>
          <div>Customer</div>
          <div>Email</div>
          <div>Amount</div>
          <div>Status</div>
          <div>Line Items</div>
          <div>Created At</div>
          <div style={{ textAlign: 'center' }}>Actions</div>
        </div>

        {orders.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
            No orders found matching your criteria.
          </div>
        )}

        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const order = orders[virtualRow.index]
            if (!order) return null
            return (
              <div
                key={order.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: '70px 1.2fr 1.5fr 100px 110px 1.8fr 150px 140px',
                  alignItems: 'center',
                  padding: '0 16px',
                  boxSizing: 'border-box',
                  borderBottom: '1px solid #f1f5f9',
                  fontSize: 13,
                  backgroundColor: virtualRow.index % 2 === 0 ? '#ffffff' : '#fafafa'
                }}
              >
                <div style={{ color: '#64748b' }}>#{order.id}</div>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{order.customerName}</div>
                <div style={{ color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {order.customerEmail}
                </div>
                <div style={{ fontWeight: 600, color: '#047857' }}>
                  ${Number(order.amount).toFixed(2)}
                </div>
                <div>
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: 9999,
                      fontSize: 11,
                      fontWeight: 600,
                      ...getStatusBadgeStyle(order.status)
                    }}
                  >
                    {order.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {Array.isArray(order.items) && order.items.length > 0 ? (
                    <span title={order.items.map(it => `${it.quantity}x ${it.productName} ($${it.unitPrice})`).join(', ')}>
                      <strong>{order.items.length} items:</strong> {order.items.map(it => `${it.quantity}x ${it.productName}`).join(', ')}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>None</span>
                  )}
                </div>
                <div style={{ color: '#64748b' }}>
                  {new Date(order.createdAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  {/* Cancel Button (Available to both AGENT and ADMIN) */}
                  {order.status !== 'CANCELLED' && (
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      title="Cancel Order"
                      style={{
                        padding: '3px 7px',
                        fontSize: 11,
                        color: '#b45309',
                        backgroundColor: '#fef3c7',
                        border: '1px solid #fde68a',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      Cancel
                    </button>
                  )}

                  {/* Delete Button (Strictly ADMIN Only) */}
                  {currentUser?.role === 'ADMIN' && (
                    <button
                      onClick={() => handleDeleteOrder(order.id)}
                      title="Delete Order (Admin only)"
                      style={{
                        padding: '3px 7px',
                        fontSize: 11,
                        color: '#b91c1c',
                        backgroundColor: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pagination Controls */}
      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <span style={{ fontSize: 13, color: '#64748b' }}>
          Page {page} of {totalPages || 1}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              opacity: page <= 1 ? 0.5 : 1
            }}
          >
            ← Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              opacity: page >= totalPages ? 0.5 : 1
            }}
          >
            Next →
          </button>
        </div>
      </footer>

      {/* R2: Create Order Modal with Idempotency Protection */}
      <CreateOrderModal
        isOpen={isCreateModalOpen}
        token={token}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          checkHealth()
          setPage(1)
        }}
      />

      {/* Authentication Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccess={handleLoginSuccess}
      />
    </div>
  )
}

export default App
