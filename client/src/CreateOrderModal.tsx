import { useEffect, useRef, useState } from 'react'
import { uuidv7 } from 'uuidv7'

export interface OrderItemInput {
  productName: string
  quantity: number
  unitPrice: number
}

interface CreateOrderModalProps {
  isOpen: boolean
  token: string | null
  onClose: () => void
  onSuccess: () => void
}

export function CreateOrderModal({ isOpen, token, onClose, onSuccess }: CreateOrderModalProps) {
  const [customerName, setCustomerName] = useState('Alex Mercer')
  const [customerEmail, setCustomerEmail] = useState('alex.mercer@example.com')
  const [items, setItems] = useState<OrderItemInput[]>([
    { productName: 'Wireless Mechanical Keyboard', quantity: 1, unitPrice: 129.99 }
  ])

  const [submitting, setSubmitting] = useState(false)
  const [retryStatus, setRetryStatus] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Ref to hold the frozen key across submission retries
  const currentSubmissionKeyRef = useRef<string | null>(null)
  const isSubmittingRef = useRef<boolean>(false)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormError(null)
      setSuccessMsg(null)
      setRetryStatus(null)
      setSubmitting(false)
      currentSubmissionKeyRef.current = null
      isSubmittingRef.current = false
    }
  }, [isOpen])

  if (!isOpen) return null

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  }

  const handleAddItem = () => {
    if (items.length >= 10) return
    setItems([...items, { productName: '', quantity: 1, unitPrice: 10.0 }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof OrderItemInput, value: string | number) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }
    setItems(updated)
  }

  const validateForm = (): string | null => {
    if (!customerName.trim() || customerName.trim().length < 2) {
      return 'Customer name must be at least 2 characters.'
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!customerEmail.trim() || !emailRegex.test(customerEmail.trim())) {
      return 'Please enter a valid email address.'
    }
    if (items.length === 0) {
      return 'Order must contain at least 1 item.'
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.productName.trim()) {
        return `Item #${i + 1}: Product name is required.`
      }
      if (!Number.isInteger(Number(it.quantity)) || Number(it.quantity) < 1) {
        return `Item #${i + 1}: Quantity must be at least 1.`
      }
      if (isNaN(Number(it.unitPrice)) || Number(it.unitPrice) <= 0) {
        return `Item #${i + 1}: Unit price must be greater than $0.`
      }
    }
    return null
  }

  /**
   * Submit handler:
   * 1. If this is a new submission: generate a brand new UUIDv7 right here on Click.
   * 2. If it's a retry or re-click while in progress: uses the EXACT frozen key.
   */
  const handleCreateOrder = async (retryAttempt = 0) => {
    // If a request is already in progress, ignore subsequent rapid clicks
    if (isSubmittingRef.current && retryAttempt === 0) {
      return
    }

    setFormError(null)

    const validationError = validateForm()
    if (validationError) {
      setFormError(validationError)
      return
    }

    // Determine the key:
    // If not currently in a submission attempt, generate fresh UUIDv7 ON CLICK.
    // If auto-retrying, freeze and reuse the same key!
    let keyToUse = currentSubmissionKeyRef.current
    if (!keyToUse) {
      keyToUse = uuidv7()
      currentSubmissionKeyRef.current = keyToUse
    }

    isSubmittingRef.current = true
    setSubmitting(true)

    const payload = {
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      items: items.map((it) => ({
        productName: it.productName.trim(),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice)
      }))
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': keyToUse
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      const data = await res.json()

      // 200 OK / 201 Created -> Success or Cached Replay
      if (res.ok) {
        const isReplay = res.headers.get('X-Idempotent-Replay') === 'true'
        setSuccessMsg(
          `Order #${data.order.id} ${
            isReplay ? '(Idempotent Replay Confirmed)' : 'created successfully'
          }!`
        )
        setRetryStatus(null)
        currentSubmissionKeyRef.current = null // Completed: release key
        onSuccess()

        setTimeout(() => {
          onClose()
          setSuccessMsg(null)
          setSubmitting(false)
          isSubmittingRef.current = false
        }, 1500)
        return
      }

      // 409 Conflict -> In-Flight or Duplicate
      if (res.status === 409) {
        const errMsg: string = data.error || ''
        if (errMsg.toLowerCase().includes('in progress') || errMsg.toLowerCase().includes('concurrent')) {
          setRetryStatus('A request with this key is currently being processed. Please wait...')

          // Wait 2 seconds and retry with the SAME frozen key
          if (retryAttempt < 4) {
            await new Promise((r) => setTimeout(r, 2000))
            return handleCreateOrder(retryAttempt + 1)
          }
        }
        throw new Error(`Conflict: ${errMsg}`)
      }

      // 422 Unprocessable
      if (res.status === 422) {
        currentSubmissionKeyRef.current = null
        isSubmittingRef.current = false
        throw new Error(`Validation Error: ${data.error}`)
      }

      currentSubmissionKeyRef.current = null
      isSubmittingRef.current = false
      throw new Error(data.error || `HTTP ${res.status}`)
    } catch (err: unknown) {
      setFormError((err as Error).message)
      setRetryStatus(null)
      isSubmittingRef.current = false
    } finally {
      if (!retryStatus) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          width: '100%',
          maxWidth: 600,
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: 24,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Create New Order</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748b' }}
          >
            ×
          </button>
        </div>

        {/* Error Feedback */}
        {formError && (
          <div
            style={{
              padding: 10,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12
            }}
          >
            {formError}
          </div>
        )}

        {/* Success Feedback */}
        {successMsg && (
          <div
            style={{
              padding: 10,
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#166534',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12
            }}
          >
            {successMsg}
          </div>
        )}

        {/* Retry / In-flight Status Notification */}
        {retryStatus && (
          <div
            style={{
              padding: 10,
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              color: '#92400e',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12
            }}
          >
            {retryStatus}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleCreateOrder(); }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              Customer Name *
            </label>
            <input
              type="text"
              required
              disabled={submitting}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              Customer Email *
            </label>
            <input
              type="email"
              required
              disabled={submitting}
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Line Items (1–5)</label>
              <button
                type="button"
                onClick={handleAddItem}
                disabled={items.length >= 5 || submitting}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#f1f5f9',
                  cursor: items.length >= 5 || submitting ? 'not-allowed' : 'pointer'
                }}
              >
                + Add Item
              </button>
            </div>

            {items.map((it, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  type="text"
                  placeholder="Product name"
                  required
                  disabled={submitting}
                  value={it.productName}
                  onChange={(e) => handleItemChange(idx, 'productName', e.target.value)}
                  style={{ flex: 3, padding: '6px 10px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 13 }}
                />
                <input
                  type="number"
                  placeholder="Qty"
                  min="1"
                  required
                  disabled={submitting}
                  value={it.quantity}
                  onChange={(e) => handleItemChange(idx, 'quantity', parseInt(e.target.value) || 1)}
                  style={{ width: 60, padding: '6px 10px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 13 }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price"
                  min="0.01"
                  required
                  disabled={submitting}
                  value={it.unitPrice}
                  onChange={(e) => handleItemChange(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                  style={{ width: 85, padding: '6px 10px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 13 }}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveItem(idx)}
                  disabled={items.length <= 1 || submitting}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: items.length <= 1 || submitting ? '#cbd5e1' : '#ef4444',
                    cursor: items.length <= 1 || submitting ? 'not-allowed' : 'pointer',
                    fontSize: 16
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderTop: '1px solid #e2e8f0',
              marginBottom: 16
            }}
          >
            <span style={{ fontWeight: 600, color: '#334155' }}>Calculated Total Amount:</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#047857' }}>${calculateTotal().toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                backgroundColor: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: '#0284c7',
                color: '#fff',
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1
              }}
            >
              {submitting ? 'Creating Order...' : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
