import { useEffect, useState } from 'react'
import './App.css'

const BLOOMCART_EXTENSION_ID = 'naflnfaamlcdjakgmhaiggmolhceiaok'
const POLL_INTERVAL_MS = 2000

type Product = {
  name: string | null
  price: string | null
  quantity: string | null
  image: string | null
  link: string | null
}

type CartCapture = {
  supportedSite: string
  sourceUrl: string
  extractedAt: string
  capturedByExtensionAt?: string
  productCount: number
  products: Product[]
}

type ExtensionResponse = {
  ok: boolean
  cart?: CartCapture | null
  error?: string
}

type ConnectionStatus = 'checking' | 'connected' | 'empty' | 'disconnected'

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: { message?: string }
        sendMessage?: (
          extensionId: string,
          message: { type: string },
          callback: (response?: ExtensionResponse) => void,
        ) => void
      }
    }
  }
}

function formatDate(value?: string) {
  if (!value) {
    return 'Not captured yet'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function App() {
  const [cart, setCart] = useState<CartCapture | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('checking')
  const [message, setMessage] = useState('Connecting to the BloomCart extension...')

  useEffect(() => {
    let stopped = false

    function pollExtension() {
      if (!window.chrome?.runtime?.sendMessage) {
        setStatus('disconnected')
        setMessage('Chrome runtime is unavailable. Open this page in Chrome with the BloomCart extension installed.')
        return
      }

      window.chrome.runtime.sendMessage(
        BLOOMCART_EXTENSION_ID,
        { type: 'BLOOMCART_GET_LATEST_CART' },
        (response) => {
          if (stopped) {
            return
          }

          const runtimeError = window.chrome?.runtime?.lastError?.message

          if (runtimeError) {
            setStatus('disconnected')
            setMessage(`Extension not connected: ${runtimeError}`)
            return
          }

          if (!response?.ok) {
            setStatus('disconnected')
            setMessage(response?.error || 'The BloomCart extension did not return cart data.')
            return
          }

          setCart(response.cart ?? null)

          if (response.cart) {
            setStatus('connected')
            setMessage(`Live cart data from ${response.cart.supportedSite}`)
          } else {
            setStatus('empty')
            setMessage('Extension connected. Waiting for a supported cart page capture.')
          }
        },
      )
    }

    pollExtension()
    const intervalId = window.setInterval(pollExtension, POLL_INTERVAL_MS)

    return () => {
      stopped = true
      window.clearInterval(intervalId)
    }
  }, [])

  const products = cart?.products ?? []

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">BloomCart Extension Dashboard</p>
          <h1>Live cart capture</h1>
          <p className="lede">
            Keep this page open while shopping. Supported cart pages update here automatically through the
            Chrome extension runtime.
          </p>
        </div>
        <div className={`status-card status-${status}`}>
          <span className="status-dot" />
          <div>
            <strong>{status === 'connected' ? 'Connected' : status === 'empty' ? 'Listening' : 'Not connected'}</strong>
            <p>{message}</p>
          </div>
        </div>
      </section>

      <section className="summary-grid" aria-label="Latest capture summary">
        <article>
          <span>Supported site</span>
          <strong>{cart?.supportedSite ?? 'None yet'}</strong>
        </article>
        <article>
          <span>Products</span>
          <strong>{cart?.productCount ?? 0}</strong>
        </article>
        <article>
          <span>Extracted</span>
          <strong>{formatDate(cart?.extractedAt)}</strong>
        </article>
      </section>

      {cart?.sourceUrl && (
        <section className="source-panel">
          <span>Source cart page</span>
          <a href={cart.sourceUrl} target="_blank" rel="noreferrer">
            {cart.sourceUrl}
          </a>
        </section>
      )}

      <section className="products-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Captured Products</p>
            <h2>{products.length ? `${products.length} item${products.length === 1 ? '' : 's'}` : 'No cart data yet'}</h2>
          </div>
          {cart?.capturedByExtensionAt && <time>{formatDate(cart.capturedByExtensionAt)}</time>}
        </div>

        {products.length ? (
          <div className="product-list">
            {products.map((product, index) => (
              <article className="product-card" key={`${product.name}-${product.price}-${product.link}-${index}`}>
                <div className="product-image">
                  {product.image ? <img src={product.image} alt="" /> : <span>No image</span>}
                </div>
                <div className="product-copy">
                  <h3>{product.name || 'Unnamed product'}</h3>
                  <dl>
                    <div>
                      <dt>Price</dt>
                      <dd>{product.price || 'Unknown'}</dd>
                    </div>
                    <div>
                      <dt>Quantity</dt>
                      <dd>{product.quantity || 'Unknown'}</dd>
                    </div>
                  </dl>
                  {product.link && (
                    <a href={product.link} target="_blank" rel="noreferrer">
                      Open product
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>Waiting for cart items</strong>
            <p>Open a supported cart page in Chrome: Amazon, Walmart, or Target.</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
