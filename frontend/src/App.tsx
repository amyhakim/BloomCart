import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  ContactShadows,
  Float,
  RoundedBox,
  Sparkles,
  Text,
  useCursor,
  useGLTF,
} from '@react-three/drei'
import gsap from 'gsap'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import CrosshairCursor from './components/CrosshairCursor'
import './App.css'

type CameraView = 'default' | 'register' | 'waiting' | 'worth' | 'dragon' | 'product'

const BLOOMCART_EXTENSION_ID = 'naflnfaamlcdjakgmhaiggmolhceiaok'
const EXTENSION_POLL_INTERVAL_MS = 2000
const MAX_EXTENSION_PRODUCTS = 10

type Product = {
  id: string
  name: string
  price: string
  lowest: string
  rating: string
  verdict: string
  saleDate: string
  badge: string
  shelf: 'Worth It' | 'Waiting for a Sale' | 'Purchased' | 'Recently Added'
  colorA: string
  colorB: string
  position: [number, number, number]
  graph: number[]
  isNew?: boolean
}

type ExtensionCartItem = {
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
  productCount: number
  products: ExtensionCartItem[]
}

type ExtensionResponse = {
  ok: boolean
  cart?: CartCapture | null
  error?: string
}

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

const extensionProductPositions: Array<[number, number, number]> = [
  [-2.35, 2.05, -2.66],
  [-1.45, 2.05, -2.66],
  [1.45, 2.05, -2.66],
  [2.35, 2.05, -2.66],
  [-2.35, 0.95, -2.66],
  [-1.45, 0.95, -2.66],
  [-0.45, 0.95, -2.66],
  [0.45, 0.95, -2.66],
  [1.45, 0.95, -2.66],
  [2.35, 0.95, -2.66],
]

const productPalettes = [
  ['#9cbad6', '#d9b3d7'],
  ['#dcbf91', '#879f7a'],
  ['#cbd7b3', '#f6dec8'],
  ['#c89253', '#f3dca6'],
  ['#b98d8d', '#8aa6b5'],
  ['#ead9a8', '#b5a1c8'],
  ['#d78d68', '#fff0d9'],
  ['#a6c8ba', '#e7c49b'],
  ['#c7b1d7', '#f0d7a6'],
  ['#9db1bd', '#d8aa8a'],
]

const cameraViews: Record<Exclude<CameraView, 'product'>, { position: THREE.Vector3; lookAt: THREE.Vector3 }> = {
  default: {
    position: new THREE.Vector3(0, 1.75, 5.6),
    lookAt: new THREE.Vector3(0, 1.15, -0.9),
  },
  register: {
    position: new THREE.Vector3(0, 1.35, 3.1),
    lookAt: new THREE.Vector3(0, 1.0, 0.65),
  },
  waiting: {
    position: new THREE.Vector3(-2.25, 1.75, 1.1),
    lookAt: new THREE.Vector3(-2.25, 1.35, -2.45),
  },
  worth: {
    position: new THREE.Vector3(2.25, 1.75, 1.1),
    lookAt: new THREE.Vector3(2.25, 1.35, -2.45),
  },
  dragon: {
    position: new THREE.Vector3(0.05, 1.45, 2.35),
    lookAt: new THREE.Vector3(0, 1.28, -0.55),
  },
}

const initialProducts: Product[] = [
  {
    id: 'linen-tote',
    name: 'Linen Market Tote',
    price: '$34',
    lowest: '$27',
    rating: '92 / 100',
    verdict: 'Worth it now',
    saleDate: 'Jul 18',
    badge: 'Worth It',
    shelf: 'Worth It',
    colorA: '#dcbf91',
    colorB: '#879f7a',
    position: [1.45, 2.05, -2.66],
    graph: [0.38, 0.45, 0.41, 0.35, 0.3],
  },
  {
    id: 'matcha-mug',
    name: 'Matcha Ceramic Mug',
    price: '$22',
    lowest: '$18',
    rating: '88 / 100',
    verdict: 'Cozy pick',
    saleDate: 'Jul 24',
    badge: 'Worth It',
    shelf: 'Worth It',
    colorA: '#cbd7b3',
    colorB: '#f6dec8',
    position: [2.35, 2.05, -2.66],
    graph: [0.5, 0.43, 0.44, 0.37, 0.33],
  },
  {
    id: 'desk-lamp',
    name: 'Brass Reading Lamp',
    price: '$78',
    lowest: '$61',
    rating: '84 / 100',
    verdict: 'Wait one drop',
    saleDate: 'Aug 02',
    badge: 'Waiting',
    shelf: 'Waiting for a Sale',
    colorA: '#c89253',
    colorB: '#f3dca6',
    position: [-2.35, 2.05, -2.66],
    graph: [0.75, 0.72, 0.64, 0.58, 0.52],
  },
  {
    id: 'wool-rug',
    name: 'Mini Wool Rug',
    price: '$96',
    lowest: '$72',
    rating: '80 / 100',
    verdict: 'Watch closely',
    saleDate: 'Aug 09',
    badge: 'Waiting',
    shelf: 'Waiting for a Sale',
    colorA: '#b98d8d',
    colorB: '#8aa6b5',
    position: [-1.45, 2.05, -2.66],
    graph: [0.8, 0.72, 0.7, 0.62, 0.55],
  },
  {
    id: 'plush-fox',
    name: 'Pocket Fox Plush',
    price: '$19',
    lowest: '$15',
    rating: '95 / 100',
    verdict: 'Purchased joy',
    saleDate: 'Bought',
    badge: 'Purchased',
    shelf: 'Purchased',
    colorA: '#d78d68',
    colorB: '#fff0d9',
    position: [-0.45, 0.95, -2.66],
    graph: [0.48, 0.41, 0.39, 0.36, 0.32],
  },
  {
    id: 'paper-notes',
    name: 'Handmade Notes',
    price: '$12',
    lowest: '$9',
    rating: '90 / 100',
    verdict: 'Lovely refill',
    saleDate: 'Jul 29',
    badge: 'Added',
    shelf: 'Recently Added',
    colorA: '#ead9a8',
    colorB: '#b5a1c8',
    position: [0.45, 0.95, -2.66],
    graph: [0.55, 0.49, 0.47, 0.42, 0.36],
  },
]

const ArchiveScene = lazy(async () => ({ default: Scene }))

function getStableHash(value: string) {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash).toString(36)
}

function getExtensionCart() {
  return new Promise<ExtensionResponse>((resolve) => {
    if (!window.chrome?.runtime?.sendMessage) {
      resolve({ ok: false, error: 'Chrome runtime is unavailable.' })
      return
    }

    window.chrome.runtime.sendMessage(
      BLOOMCART_EXTENSION_ID,
      { type: 'BLOOMCART_GET_LATEST_CART' },
      (response) => {
        const runtimeError = window.chrome?.runtime?.lastError?.message

        if (runtimeError) {
          resolve({ ok: false, error: runtimeError })
          return
        }

        resolve(response ?? { ok: false, error: 'The BloomCart extension did not respond.' })
      },
    )
  })
}

function cartCaptureToProducts(cart: CartCapture): Product[] {
  return cart.products.slice(0, MAX_EXTENSION_PRODUCTS).map((item, index) => {
    const name = item.name || 'Captured Cart Item'
    const price = item.price || 'Unknown'
    const hash = getStableHash(`${cart.supportedSite}|${name}|${price}|${item.link ?? index}`)
    const palette = productPalettes[index % productPalettes.length]

    return {
      id: `extension-${hash}`,
      name,
      price,
      lowest: price,
      rating: 'Analyzing',
      verdict: 'Recently captured',
      saleDate: 'Captured',
      badge: item.quantity ? `Qty ${item.quantity}` : 'New',
      shelf: 'Recently Added',
      colorA: palette[0],
      colorB: palette[1],
      position: extensionProductPositions[index],
      graph: [0.68, 0.61, 0.56, 0.5, 0.45],
      isNew: true,
    }
  })
}

function App() {
  const [view, setView] = useState<CameraView>('default')
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [notification, setNotification] = useState('Dragon archivist is ready.')
  const lastExtensionSignature = useRef('')

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null

  const syncExtensionCart = useCallback(async (manual = false) => {
    if (manual) {
      setNotification('Checking the BloomCart extension...')
    }

    const response = await getExtensionCart()

    if (!response.ok) {
      if (manual || !lastExtensionSignature.current) {
        setNotification(`Extension not connected: ${response.error ?? 'unknown error'}`)
      }
      return
    }

    if (!response.cart) {
      if (manual || !lastExtensionSignature.current) {
        setNotification('Waiting for a supported cart page capture.')
      }
      return
    }

    const signature = JSON.stringify({
      site: response.cart.supportedSite,
      sourceUrl: response.cart.sourceUrl,
      products: response.cart.products.slice(0, MAX_EXTENSION_PRODUCTS),
    })

    if (!manual && signature === lastExtensionSignature.current) {
      return
    }

    lastExtensionSignature.current = signature

    const capturedProducts = cartCaptureToProducts(response.cart)
    const visibleCount = capturedProducts.length

    setProducts(capturedProducts)
    setSelectedProductId(capturedProducts[0]?.id ?? null)
    setView(capturedProducts[0] ? 'product' : 'default')
    setNotification(
      visibleCount
        ? `${visibleCount} cart item${visibleCount === 1 ? '' : 's'} archived from ${response.cart.supportedSite}.`
        : `No products found in the latest ${response.cart.supportedSite} cart capture.`,
    )
    setIsAnalyzing(true)
    window.setTimeout(() => setIsAnalyzing(false), 1200)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedProductId(null)
        setView('default')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const initialPollId = window.setTimeout(() => void syncExtensionCart(), 0)
    const intervalId = window.setInterval(() => void syncExtensionCart(), EXTENSION_POLL_INTERVAL_MS)

    return () => {
      window.clearTimeout(initialPollId)
      window.clearInterval(intervalId)
    }
  }, [syncExtensionCart])

  return (
    <main className="app-shell">
      <div className="world-frame">
        <Canvas
          shadows
          dpr={[1, 1.8]}
          camera={{ position: [0, 2.4, 7], fov: 43, near: 0.1, far: 100 }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={['#f5ead8']} />
          <Suspense fallback={<LoadingRoom />}>
            <ArchiveScene
              isAnalyzing={isAnalyzing}
              products={products}
              selectedProduct={selectedProduct}
              selectedProductId={selectedProductId}
              setSelectedProductId={setSelectedProductId}
              setView={setView}
              view={view}
            />
          </Suspense>
        </Canvas>
      </div>
      <CrosshairCursor />

      <nav className="top-controls" aria-label="BloomCart controls">
        <button type="button" onClick={() => void syncExtensionCart(true)}>Refresh Cart</button>
        <button type="button" onClick={() => setView('default')}>Settings</button>
        <button type="button" className="notification-pill">{notification}</button>
      </nav>

      <button
        type="button"
        className="back-control"
        onClick={() => {
          setSelectedProductId(null)
          setView('default')
        }}
      >
        Back / ESC
      </button>
    </main>
  )
}

function Scene({
  isAnalyzing,
  products,
  selectedProduct,
  selectedProductId,
  setSelectedProductId,
  setView,
  view,
}: {
  isAnalyzing: boolean
  products: Product[]
  selectedProduct: Product | null
  selectedProductId: string | null
  setSelectedProductId: (id: string | null) => void
  setView: (view: CameraView) => void
  view: CameraView
}) {
  return (
    <>
      <CameraRig selectedProduct={selectedProduct} view={view} />
      <ambientLight intensity={0.9} color="#f7dfbd" />
      <directionalLight
        castShadow
        color="#ffd49a"
        intensity={2.7}
        position={[-3.8, 5.4, 4.6]}
        shadow-mapSize={[2048, 2048]}
      />
      <pointLight color="#ffd28d" intensity={2.2} position={[2.7, 2.55, 0.4]} distance={5.5} />
      <pointLight color="#ffdcaa" intensity={1.5} position={[-2.8, 1.9, -1.35]} distance={3.5} />

      <RoomShell />
      <Decorations />
      <ArchiveShelves
        products={products}
        selectedProductId={selectedProductId}
        setSelectedProductId={setSelectedProductId}
        setView={setView}
      />
      <IsabelleDesk isAnalyzing={isAnalyzing} setView={setView} />
      <Dragon isAnalyzing={isAnalyzing} setView={setView} />
      <FloatingDust />
      <ContactShadows opacity={0.28} scale={9} blur={2.6} far={4.5} position={[0, 0.012, 0]} />
    </>
  )
}

function CameraRig({ selectedProduct, view }: { selectedProduct: Product | null; view: CameraView }) {
  const { camera, gl, mouse } = useThree()
  const basePosition = useRef(new THREE.Vector3(0, 2.35, 7))
  const targetYaw = useRef(0)
  const targetPitch = useRef(0)
  const smoothYaw = useRef(0)
  const smoothPitch = useRef(0)
  const smoothMouse = useRef(new THREE.Vector2())
  const desiredPosition = useRef(new THREE.Vector3())
  const desiredLookAt = useRef(new THREE.Vector3())
  const parallaxOffset = useRef(new THREE.Vector3())
  const lookDirection = useRef(new THREE.Vector3())
  const dragState = useRef({ active: false, moved: 0 })

  useEffect(() => {
    const canvas = gl.domElement
    const sensitivity = 0.0032

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragState.current.active = true
      dragState.current.moved = 0
      canvas.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragState.current.active) return
      dragState.current.moved += Math.abs(event.movementX) + Math.abs(event.movementY)
      targetYaw.current -= event.movementX * sensitivity
      targetPitch.current = THREE.MathUtils.clamp(
        targetPitch.current - event.movementY * sensitivity,
        -Math.PI / 2.7,
        Math.PI / 2.7,
      )
    }

    const stopDragging = (event: PointerEvent) => {
      dragState.current.active = false
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', stopDragging)
    canvas.addEventListener('pointercancel', stopDragging)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', stopDragging)
      canvas.removeEventListener('pointercancel', stopDragging)
    }
  }, [gl])

  useEffect(() => {
    const target =
      view === 'product' && selectedProduct
        ? {
            position: new THREE.Vector3(
              selectedProduct.position[0],
              selectedProduct.position[1] + 0.18,
              selectedProduct.position[2] + 1.95,
            ),
            lookAt: new THREE.Vector3(...selectedProduct.position),
          }
        : cameraViews[view === 'product' ? 'default' : view]
    const facing = getCameraAngles(target.position, target.lookAt)

    gsap.to(basePosition.current, {
      x: target.position.x,
      y: target.position.y,
      z: target.position.z,
      duration: 1.9,
      ease: 'power3.inOut',
    })
    gsap.to(targetYaw, {
      current: facing.yaw,
      duration: 1.9,
      ease: 'power3.inOut',
    })
    gsap.to(targetPitch, {
      current: facing.pitch,
      duration: 1.9,
      ease: 'power3.inOut',
    })
  }, [selectedProduct, view])

  useFrame((_, delta) => {
    const mouseBlend = 1 - Math.exp(-10 * delta)
    const cameraBlend = 1 - Math.exp(-7.5 * delta)
    const rotationBlend = 1 - Math.exp(-12 * delta)

    smoothMouse.current.lerp(mouse, mouseBlend)
    smoothYaw.current = THREE.MathUtils.lerp(smoothYaw.current, targetYaw.current, rotationBlend)
    smoothPitch.current = THREE.MathUtils.lerp(smoothPitch.current, targetPitch.current, rotationBlend)
    parallaxOffset.current.set(smoothMouse.current.x * 0.035, smoothMouse.current.y * 0.022, 0)
    desiredPosition.current.copy(basePosition.current).add(parallaxOffset.current)
    lookDirection.current.set(
      Math.sin(smoothYaw.current) * Math.cos(smoothPitch.current),
      Math.sin(smoothPitch.current),
      -Math.cos(smoothYaw.current) * Math.cos(smoothPitch.current),
    )
    desiredLookAt.current.copy(desiredPosition.current).add(lookDirection.current)

    camera.position.lerp(desiredPosition.current, cameraBlend)
    camera.lookAt(desiredLookAt.current)
  })

  return null
}

function getCameraAngles(position: THREE.Vector3, lookAt: THREE.Vector3) {
  const direction = lookAt.clone().sub(position).normalize()

  return {
    yaw: Math.atan2(direction.x, -direction.z),
    pitch: Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)),
  }
}

function LoadingRoom() {
  return (
    <group position={[0, 1.1, -1]}>
      <Text color="#7b5e48" fontSize={0.18} anchorX="center">BloomCart archive is opening...</Text>
    </group>
  )
}

function RoomShell() {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[8.8, 8.2]} />
        <meshStandardMaterial color="#c99f72" roughness={0.82} />
      </mesh>
      <mesh receiveShadow position={[0, 2.05, -3.05]}>
        <boxGeometry args={[8.8, 4.1, 0.16]} />
        <meshStandardMaterial color="#f1dfc7" roughness={0.9} />
      </mesh>
      <mesh receiveShadow position={[-4.35, 2.05, 0]}>
        <boxGeometry args={[0.16, 4.1, 8.2]} />
        <meshStandardMaterial color="#efe0cc" roughness={0.92} />
      </mesh>
      <mesh receiveShadow position={[4.35, 2.05, 0]}>
        <boxGeometry args={[0.16, 4.1, 8.2]} />
        <meshStandardMaterial color="#efe0cc" roughness={0.92} />
      </mesh>
      <mesh position={[-3.25, 2.62, -3.16]}>
        <boxGeometry args={[1.22, 1.05, 0.08]} />
        <meshStandardMaterial color="#ffe8bd" emissive="#ffc875" emissiveIntensity={0.32} />
      </mesh>
      <mesh position={[-3.25, 2.62, -3.1]}>
        <boxGeometry args={[1.36, 1.18, 0.08]} />
        <meshStandardMaterial color="#a87952" roughness={0.65} />
      </mesh>
      <mesh position={[-2.92, 2.62, -3.23]} rotation={[0, 0, -0.4]}>
        <boxGeometry args={[0.05, 1.25, 0.04]} />
        <meshStandardMaterial color="#fff1cf" emissive="#ffd080" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[-3.58, 2.62, -3.23]} rotation={[0, 0, 0.4]}>
        <boxGeometry args={[0.05, 1.25, 0.04]} />
        <meshStandardMaterial color="#fff1cf" emissive="#ffd080" emissiveIntensity={0.5} />
      </mesh>
      <Rug />
    </group>
  )
}

function Rug() {
  return (
    <group position={[0, 0.025, 2.15]} rotation={[-Math.PI / 2, 0, 0]}>
      <RoundedBox args={[3.4, 1.72, 0.025]} radius={0.08} smoothness={8}>
        <meshStandardMaterial color="#bd8f86" roughness={0.95} />
      </RoundedBox>
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x) => (
        <mesh key={x} position={[x, 0, 0.025]}>
          <boxGeometry args={[0.045, 1.58, 0.012]} />
          <meshStandardMaterial color="#e5ccb0" />
        </mesh>
      ))}
    </group>
  )
}

function IsabelleDesk({
  isAnalyzing,
  setView,
}: {
  isAnalyzing: boolean
  setView: (view: CameraView) => void
}) {
  return (
    <ClickableGroup onClick={() => setView('register')}>
      <group position={[0, 0, 0.72]}>
        <DeskCabinet />
        <DeskTop />
        <Monitor />
        <PapersOnDesk />
        <Mug />
        <PenHolder />
        <Telephone />
        <RedBox />
        <NamePlate />
        <Scanner isAnalyzing={isAnalyzing} />
        <Keyboard isAnalyzing={isAnalyzing} />
        {isAnalyzing && <ScanProduct />}
      </group>
    </ClickableGroup>
  )
}

function DeskCabinet() {
  const drawerCols = [-0.85, -0.28, 0.28, 0.85]

  return (
    <group position={[0, 0.42, -0.15]}>
      <RoundedBox castShadow receiveShadow args={[2.6, 0.84, 0.9]} radius={0.03} smoothness={4}>
        <meshStandardMaterial color="#7a4a30" roughness={0.55} />
      </RoundedBox>

      {[0.18, -0.18].map((rowY) =>
        drawerCols.map((x) => (
          <group key={`${x}-${rowY}`} position={[x, rowY, 0.455]}>
            <mesh castShadow>
              <boxGeometry args={[0.48, 0.3, 0.02]} />
              <meshStandardMaterial color="#8a5636" roughness={0.5} />
            </mesh>
            <mesh position={[0, 0, 0.015]}>
              <boxGeometry args={[0.16, 0.03, 0.02]} />
              <meshStandardMaterial color="#d9b45a" metalness={0.6} roughness={0.3} />
            </mesh>
          </group>
        )),
      )}
    </group>
  )
}

function DeskTop() {
  return (
    <mesh castShadow receiveShadow position={[0, 0.855, -0.15]}>
      <boxGeometry args={[2.78, 0.06, 1.02]} />
      <meshStandardMaterial color="#96603c" roughness={0.42} />
    </mesh>
  )
}

function Monitor() {
  return (
    <group position={[-0.95, 0.88, 0.1]}>
      <mesh castShadow>
        <boxGeometry args={[0.06, 0.42, 0.32]} />
        <meshStandardMaterial color="#8a5636" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0.16, 0.02, 0]}>
        <boxGeometry args={[0.34, 0.34, 0.28]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.35} />
      </mesh>
      <mesh position={[0.335, 0.02, 0]}>
        <boxGeometry args={[0.02, 0.26, 0.2]} />
        <meshStandardMaterial color="#101010" emissive="#1c2b33" emissiveIntensity={0.4} />
      </mesh>
    </group>
  )
}

function PapersOnDesk() {
  return (
    <group position={[-0.15, 0.892, 0.15]} rotation={[-Math.PI / 2, 0, 0.06]}>
      <mesh position={[0.02, -0.01, 0]}>
        <planeGeometry args={[0.32, 0.42]} />
        <meshStandardMaterial color="#f7f2e4" roughness={0.9} />
      </mesh>
      <mesh position={[-0.06, 0.03, 0.001]} rotation={[0, 0, -0.1]}>
        <planeGeometry args={[0.3, 0.4]} />
        <meshStandardMaterial color="#fdfaf0" roughness={0.9} />
      </mesh>
    </group>
  )
}

function Mug() {
  return (
    <group position={[0.35, 0.9, 0.18]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.07, 0.06, 0.11, 24]} />
        <meshStandardMaterial color="#fffaf0" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.005, 24]} />
        <meshStandardMaterial color="#5a3824" roughness={0.6} />
      </mesh>
      <mesh position={[0.08, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.035, 0.008, 8, 20]} />
        <meshStandardMaterial color="#fffaf0" roughness={0.5} />
      </mesh>
    </group>
  )
}

function PenHolder() {
  return (
    <group position={[-0.02, 0.9, 0.32]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.1, 16]} />
        <meshStandardMaterial color="#2c2c2c" roughness={0.5} />
      </mesh>
      {[-0.02, 0, 0.02].map((x, i) => (
        <mesh key={i} position={[x, 0.09, 0]} rotation={[0, 0, x * 3]}>
          <cylinderGeometry args={[0.005, 0.005, 0.14, 8]} />
          <meshStandardMaterial color={['#2c2c2c', '#c0392b', '#2255aa'][i]} />
        </mesh>
      ))}
    </group>
  )
}

function Telephone() {
  return (
    <group position={[0.75, 0.895, 0.12]}>
      <RoundedBox castShadow args={[0.28, 0.05, 0.22]} radius={0.02} smoothness={4}>
        <meshStandardMaterial color="#3a5fa0" roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0.05, -0.02]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.24, 0.05, 0.08]} />
        <meshStandardMaterial color="#3a5fa0" roughness={0.4} />
      </mesh>
      <mesh position={[0.06, 0.03, 0.06]}>
        <cylinderGeometry args={[0.05, 0.05, 0.01, 20]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>
    </group>
  )
}

function RedBox() {
  return (
    <RoundedBox castShadow args={[0.22, 0.1, 0.16]} radius={0.015} smoothness={4} position={[1.05, 0.92, 0.05]}>
      <meshStandardMaterial color="#a4342a" roughness={0.4} />
    </RoundedBox>
  )
}

function NamePlate() {
  return (
    <group position={[0.15, 0.885, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <planeGeometry args={[0.34, 0.09]} />
        <meshStandardMaterial color="#3f4a3f" roughness={0.6} />
      </mesh>
      <Text position={[0, 0, 0.001]} fontSize={0.045} color="#e8e2c8" anchorX="center" anchorY="middle">
        Isabelle
      </Text>
    </group>
  )
}

function Scanner({ isAnalyzing }: { isAnalyzing: boolean }) {
  const ring = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ring.current) return
    ring.current.rotation.z = state.clock.elapsedTime * 2.2
    ring.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 4) * 0.07)
  })

  return (
    <group position={[0.48, 0.92, -0.08]}>
      <RoundedBox castShadow args={[0.46, 0.13, 0.38]} radius={0.04} smoothness={8}>
        <meshStandardMaterial color="#a77c52" roughness={0.78} />
      </RoundedBox>
      <mesh position={[0, 0.075, 0]} ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.18, 0.009, 8, 48]} />
        <meshStandardMaterial
          color={isAnalyzing ? '#ffd591' : '#e8c79d'}
          emissive={isAnalyzing ? '#ffc46d' : '#8a5a38'}
          emissiveIntensity={isAnalyzing ? 1 : 0.16}
        />
      </mesh>
      {isAnalyzing && (
        <Sparkles count={28} scale={[0.7, 0.45, 0.7]} size={2.2} speed={0.55} color="#ffe4a8" position={[0, 0.34, 0]} />
      )}
    </group>
  )
}

function Keyboard({ isAnalyzing }: { isAnalyzing: boolean }) {
  return (
    <group position={[0.16, 0.91, 0.28]} rotation={[-0.1, 0, 0]}>
      {Array.from({ length: 16 }, (_, index) => {
        const x = (index % 8) * 0.07 - 0.245
        const z = Math.floor(index / 8) * 0.07 - 0.035

        return (
          <KeyboardKey key={index} index={index} isAnalyzing={isAnalyzing} position={[x, 0, z]} />
        )
      })}
    </group>
  )
}

function KeyboardKey({
  index,
  isAnalyzing,
  position,
}: {
  index: number
  isAnalyzing: boolean
  position: [number, number, number]
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ref.current) return
    const tap = isAnalyzing && index % 5 === 0 ? Math.sin(state.clock.elapsedTime * 12 + index) * 0.01 : 0
    ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, tap, 0.28)
  })

  return (
    <mesh ref={ref} castShadow position={position}>
      <boxGeometry args={[0.052, 0.018, 0.046]} />
      <meshStandardMaterial color="#efe0c7" roughness={0.75} />
    </mesh>
  )
}

function ScanProduct() {
  const ref = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (!ref.current) return
    ref.current.position.y = 1.32 + Math.sin(state.clock.elapsedTime * 2.2) * 0.04
    ref.current.rotation.y += 0.015
  })

  return (
    <group ref={ref} position={[0.48, 1.32, -0.08]}>
      <mesh castShadow>
        <sphereGeometry args={[0.16, 28, 18]} />
        <meshStandardMaterial color="#9cbad6" roughness={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.24, 0.008, 8, 64]} />
        <meshStandardMaterial color="#ffdca4" emissive="#ffc46d" emissiveIntensity={0.8} />
      </mesh>
      <Text position={[0.45, 0.18, 0]} fontSize={0.065} color="#7d5d42" anchorX="left">
        price -14%{'\n'}quality 91{'\n'}save soon
      </Text>
    </group>
  )
}

function Dragon({
  isAnalyzing,
  setView,
}: {
  isAnalyzing: boolean
  setView: (view: CameraView) => void
}) {
  const group = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const tail = useRef<THREE.Group>(null)
  const leftEye = useRef<THREE.Mesh>(null)
  const rightEye = useRef<THREE.Mesh>(null)
  const [blink, setBlink] = useState(false)
  const hornStripes = [-0.04, 0.04, 0.12]

  useEffect(() => {
    const interval = window.setInterval(() => {
      setBlink(true)
      window.setTimeout(() => setBlink(false), 130)
    }, 3200)

    return () => window.clearInterval(interval)
  }, [])

  useFrame((state) => {
    const time = state.clock.elapsedTime

    if (group.current) {
      group.current.position.y = 0.86 + Math.sin(time * 1.8) * 0.018
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, isAnalyzing ? -0.25 : 0, 0.05)
    }
    if (head.current) {
      head.current.rotation.z = Math.sin(time * 0.7) * 0.045
      head.current.rotation.x = Math.sin(time * 0.9) * 0.025
    }
    if (tail.current) {
      tail.current.rotation.y = Math.sin(time * 2) * 0.35
    }
    const eyeShift = THREE.MathUtils.clamp(state.camera.position.x * 0.016, -0.035, 0.035)
    if (leftEye.current) leftEye.current.position.x = -0.105 + eyeShift
    if (rightEye.current) rightEye.current.position.x = 0.105 + eyeShift
  })

  return (
    <ClickableGroup onClick={() => setView('dragon')}>
      <group ref={group} position={[0, 0.86, -0.48]}>
        <mesh castShadow position={[0, -0.18, 0]} scale={[0.78, 1.02, 0.68]}>
          <sphereGeometry args={[0.31, 36, 24]} />
          <meshStandardMaterial color="#a8d9ae" roughness={0.82} />
        </mesh>
        <mesh castShadow position={[0, -0.18, 0.24]} scale={[0.6, 0.92, 0.16]}>
          <sphereGeometry args={[0.25, 32, 18]} />
          <meshStandardMaterial color="#d9f58b" roughness={0.82} />
        </mesh>
        {[-0.02, -0.11, -0.2].map((y) => (
          <mesh key={y} position={[0, y, 0.285]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.28, 0.016, 0.012]} />
            <meshStandardMaterial color="#8fbf4e" roughness={0.75} />
          </mesh>
        ))}
        <group ref={head} position={[0, 0.24, 0.04]}>
          <mesh castShadow scale={[1.28, 1.02, 0.92]}>
            <sphereGeometry args={[0.36, 48, 28]} />
            <meshStandardMaterial color="#a9dcb2" roughness={0.82} />
          </mesh>
          <mesh castShadow position={[0, -0.08, 0.29]} scale={[0.9, 0.48, 0.36]}>
            <sphereGeometry args={[0.22, 32, 18]} />
            <meshStandardMaterial color="#bfe5b8" roughness={0.84} />
          </mesh>
          <mesh position={[-0.18, -0.06, 0.34]} scale={[1.2, 0.7, 0.2]}>
            <sphereGeometry args={[0.075, 20, 12]} />
            <meshStandardMaterial color="#f4c9a6" transparent opacity={0.55} roughness={0.9} />
          </mesh>
          <mesh position={[0.18, -0.06, 0.34]} scale={[1.2, 0.7, 0.2]}>
            <sphereGeometry args={[0.075, 20, 12]} />
            <meshStandardMaterial color="#f4c9a6" transparent opacity={0.55} roughness={0.9} />
          </mesh>
          <mesh ref={leftEye} position={[-0.13, 0.02, 0.335]} scale={[1, blink ? 0.08 : 1, 1]}>
            <sphereGeometry args={[0.045, 18, 12]} />
            <meshStandardMaterial color="#35412f" roughness={0.4} />
          </mesh>
          <mesh ref={rightEye} position={[0.13, 0.02, 0.335]} scale={[1, blink ? 0.08 : 1, 1]}>
            <sphereGeometry args={[0.045, 18, 12]} />
            <meshStandardMaterial color="#35412f" roughness={0.4} />
          </mesh>
          <mesh position={[-0.112, 0.03, 0.368]}>
            <sphereGeometry args={[0.014, 10, 8]} />
            <meshStandardMaterial color="#fff9e9" roughness={0.25} />
          </mesh>
          <mesh position={[0.148, 0.03, 0.368]}>
            <sphereGeometry args={[0.014, 10, 8]} />
            <meshStandardMaterial color="#fff9e9" roughness={0.25} />
          </mesh>
          <mesh position={[-0.13, 0.02, 0.358]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.122, 0.012, 12, 48]} />
            <meshStandardMaterial color="#ff3338" roughness={0.32} />
          </mesh>
          <mesh position={[0.13, 0.02, 0.358]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.122, 0.012, 12, 48]} />
            <meshStandardMaterial color="#ff3338" roughness={0.32} />
          </mesh>
          <mesh position={[0, 0.02, 0.36]}>
            <boxGeometry args={[0.06, 0.018, 0.018]} />
            <meshStandardMaterial color="#ff3338" roughness={0.32} />
          </mesh>
          <mesh position={[-0.275, 0.015, 0.34]} rotation={[0, 0, -0.2]}>
            <boxGeometry args={[0.08, 0.016, 0.018]} />
            <meshStandardMaterial color="#ff3338" roughness={0.32} />
          </mesh>
          <mesh position={[0.275, 0.015, 0.34]} rotation={[0, 0, 0.2]}>
            <boxGeometry args={[0.08, 0.016, 0.018]} />
            <meshStandardMaterial color="#ff3338" roughness={0.32} />
          </mesh>
          <mesh position={[-0.17, 0.08, 0.382]} rotation={[0, 0, -0.52]}>
            <boxGeometry args={[0.035, 0.19, 0.008]} />
            <meshStandardMaterial color="#fffdf0" transparent opacity={0.72} roughness={0.12} />
          </mesh>
          <mesh position={[0.18, 0.08, 0.382]} rotation={[0, 0, -0.52]}>
            <boxGeometry args={[0.035, 0.19, 0.008]} />
            <meshStandardMaterial color="#fffdf0" transparent opacity={0.72} roughness={0.12} />
          </mesh>
          <mesh position={[-0.04, -0.08, 0.37]} rotation={[0, 0, 0.45]}>
            <torusGeometry args={[0.045, 0.006, 8, 28]} />
            <meshStandardMaterial color="#22281e" roughness={0.5} />
          </mesh>
          <mesh position={[0.04, -0.08, 0.37]} rotation={[0, 0, -0.45]}>
            <torusGeometry args={[0.045, 0.006, 8, 28]} />
            <meshStandardMaterial color="#22281e" roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.145, 0.37]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.065, 0.006, 8, 32, Math.PI]} />
            <meshStandardMaterial color="#22281e" roughness={0.55} />
          </mesh>
          <group position={[0, 0.36, 0.03]}>
            <mesh castShadow rotation={[0, 0, 0]}>
              <coneGeometry args={[0.082, 0.28, 24]} />
              <meshStandardMaterial color="#d8fb74" roughness={0.72} />
            </mesh>
            {hornStripes.map((y) => (
              <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.048 + y * 0.08, 0.006, 8, 28]} />
                <meshStandardMaterial color="#8cc23e" roughness={0.7} />
              </mesh>
            ))}
          </group>
          {[
            [-0.27, 0.23, 0.01, 0.78],
            [0.27, 0.23, 0.01, -0.78],
          ].map(([x, y, z, rotationZ]) => (
            <group key={x} position={[x, y, z]} rotation={[0.05, 0, rotationZ]}>
              <mesh castShadow>
                <coneGeometry args={[0.075, 0.24, 24]} />
                <meshStandardMaterial color="#d8fb74" roughness={0.72} />
              </mesh>
              {[-0.035, 0.035].map((stripeY) => (
                <mesh key={stripeY} position={[0, stripeY, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.052, 0.005, 8, 24]} />
                  <meshStandardMaterial color="#8cc23e" roughness={0.7} />
                </mesh>
              ))}
            </group>
          ))}
          {[
            [-0.36, 0.04, 0, 0.78],
            [0.36, 0.04, 0, -0.78],
          ].map(([x, y, z, rotationZ]) => (
            <group key={x} position={[x, y, z]} rotation={[0.05, 0, rotationZ]}>
              <mesh castShadow scale={[0.12, 0.22, 0.035]}>
                <sphereGeometry args={[1, 18, 10]} />
                <meshStandardMaterial color="#8fcda0" roughness={0.82} />
              </mesh>
              <mesh position={[0, 0, 0.018]} scale={[0.08, 0.15, 0.018]}>
                <sphereGeometry args={[1, 16, 8]} />
                <meshStandardMaterial color="#d8fb74" roughness={0.82} />
              </mesh>
            </group>
          ))}
        </group>
        <group position={[0, 0.04, 0.29]}>
          <mesh position={[-0.055, 0, 0]} rotation={[0, 0, -0.95]} scale={[1.25, 0.78, 0.22]}>
            <coneGeometry args={[0.08, 0.16, 20]} />
            <meshStandardMaterial color="#f63a31" roughness={0.45} />
          </mesh>
          <mesh position={[0.055, 0, 0]} rotation={[0, 0, 0.95]} scale={[1.25, 0.78, 0.22]}>
            <coneGeometry args={[0.08, 0.16, 20]} />
            <meshStandardMaterial color="#f63a31" roughness={0.45} />
          </mesh>
          <mesh position={[0, 0, 0.006]}>
            <sphereGeometry args={[0.032, 16, 10]} />
            <meshStandardMaterial color="#da3028" roughness={0.45} />
          </mesh>
        </group>
        {[
          [-0.34, -0.16, -0.02, 0.64],
          [0.34, -0.16, -0.02, -0.64],
        ].map(([x, y, z, rotationZ]) => (
          <group key={x} position={[x, y, z]} rotation={[0.18, 0, rotationZ]}>
            <mesh castShadow scale={[0.13, 0.34, 0.035]}>
              <sphereGeometry args={[1, 20, 12]} />
              <meshStandardMaterial color="#8ecfa0" roughness={0.84} />
            </mesh>
            <mesh position={[0, -0.02, 0.018]} scale={[0.08, 0.24, 0.02]}>
              <sphereGeometry args={[1, 16, 10]} />
              <meshStandardMaterial color="#d9fb78" roughness={0.84} />
            </mesh>
          </group>
        ))}
        {[-0.16, 0.16].map((x) => (
          <group key={x} position={[x, -0.51, 0.12]}>
            <mesh castShadow scale={[0.13, 0.08, 0.18]}>
              <sphereGeometry args={[1, 18, 12]} />
              <meshStandardMaterial color="#a8d9ae" roughness={0.82} />
            </mesh>
            {[-0.045, 0, 0.045].map((toeX) => (
              <mesh key={toeX} position={[toeX, -0.018, 0.12]} scale={[0.034, 0.026, 0.035]}>
                <sphereGeometry args={[1, 10, 8]} />
                <meshStandardMaterial color="#ecffd0" roughness={0.8} />
              </mesh>
            ))}
          </group>
        ))}
        <group ref={tail} position={[0.27, -0.38, -0.24]} rotation={[0.2, 0.3, -0.8]}>
          <mesh castShadow scale={[0.065, 0.065, 0.3]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color="#9ed7a8" roughness={0.82} />
          </mesh>
          <mesh castShadow position={[0.14, -0.08, 0.18]} rotation={[0.25, 0.4, 0.85]} scale={[0.055, 0.055, 0.22]}>
            <sphereGeometry args={[1, 16, 10]} />
            <meshStandardMaterial color="#d9fb78" roughness={0.82} />
          </mesh>
        </group>
      </group>
    </ClickableGroup>
  )
}

function ArchiveShelves({
  products,
  selectedProductId,
  setSelectedProductId,
  setView,
}: {
  products: Product[]
  selectedProductId: string | null
  setSelectedProductId: (id: string | null) => void
  setView: (view: CameraView) => void
}) {
  const selectedProduct = products.find((product) => product.id === selectedProductId)

  return (
    <group position={[0, 0, 0]}>
      <ClickableGroup onClick={() => setView('waiting')}>
        <ShelfSection label="Waiting for a Sale" labelIcon="hourglass" position={[-1.9, 1.43, -2.72]} color="#aebed0" />
      </ClickableGroup>
      <ClickableGroup onClick={() => setView('worth')}>
        <ShelfSection label="Worth It" labelIcon="flower" position={[1.9, 1.43, -2.72]} color="#c7d3aa" />
      </ClickableGroup>
      <ShelfSection label="Purchased" labelIcon="star" position={[-0.65, 0.34, -2.72]} color="#e1b391" />
      <ShelfSection label="Recently Added" labelIcon="box" position={[0.65, 0.34, -2.72]} color="#cdb6d9" />

      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          selected={product.id === selectedProductId}
          onSelect={() => {
            setSelectedProductId(product.id)
            setView('product')
          }}
        />
      ))}
      {selectedProduct && <ProductInfoPanel product={selectedProduct} />}
    </group>
  )
}

function ShelfSection({
  color,
  label,
  labelIcon,
  position,
}: {
  color: string
  label: string
  labelIcon: string
  position: [number, number, number]
}) {
  return (
    <group position={position}>
      <RoundedBox castShadow receiveShadow args={[1.82, 1.1, 0.32]} radius={0.045} smoothness={6}>
        <meshStandardMaterial color="#c89d69" roughness={0.76} />
      </RoundedBox>
      <mesh position={[0, 0, 0.18]}>
        <boxGeometry args={[1.62, 0.86, 0.04]} />
        <meshStandardMaterial color="#f5e4ca" emissive="#f2c98f" emissiveIntensity={0.1} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.51, 0.22]}>
        <boxGeometry args={[1.1, 0.18, 0.035]} />
        <meshStandardMaterial color={color} roughness={0.86} />
      </mesh>
      <Text position={[0, 0.515, 0.245]} fontSize={0.052} color="#5f4b38" anchorX="center">
        {labelIcon} {label}
      </Text>
      <mesh position={[-0.46, 0.02, 0.22]}>
        <boxGeometry args={[0.03, 0.74, 0.035]} />
        <meshStandardMaterial color="#d8b27a" roughness={0.74} />
      </mesh>
      <mesh position={[0.46, 0.02, 0.22]}>
        <boxGeometry args={[0.03, 0.74, 0.035]} />
        <meshStandardMaterial color="#d8b27a" roughness={0.74} />
      </mesh>
    </group>
  )
}

function ProductCard({
  onSelect,
  product,
  selected,
}: {
  onSelect: () => void
  product: Product
  selected: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const group = useRef<THREE.Group>(null)
  const texture = useProductTexture(product)

  useCursor(hovered)

  useFrame((state) => {
    if (!group.current) return
    const time = state.clock.elapsedTime
    const targetScale = selected ? 1.22 : hovered ? 1.1 : 1

    group.current.position.y = product.position[1] + Math.sin(time * 1.4 + product.position[0]) * 0.025 + (selected ? 0.18 : 0)
    group.current.position.z = product.position[2] + (selected ? 0.25 : 0)
    group.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12)
  })

  return (
    <Float speed={1.4} floatIntensity={0.04} rotationIntensity={0.03}>
      <group
        ref={group}
        position={product.position}
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
        onPointerOut={() => setHovered(false)}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
        }}
      >
        <mesh castShadow>
          <boxGeometry args={[0.54, 0.72, 0.035]} />
          <meshStandardMaterial
            color="#fff7e7"
            emissive={selected || hovered ? '#ffdba8' : '#6b4b2f'}
            emissiveIntensity={selected ? 0.32 : hovered ? 0.18 : 0.03}
            map={texture}
            roughness={0.82}
          />
        </mesh>
        <mesh position={[0, -0.45, 0.04]}>
          <boxGeometry args={[0.64, 0.08, 0.09]} />
          <meshStandardMaterial color="#b7895a" roughness={0.8} />
        </mesh>
        <Text position={[0, -0.325, 0.055]} fontSize={0.042} color="#76553e" maxWidth={0.45} textAlign="center" anchorX="center">
          {product.price} - {product.badge}
        </Text>
        {(selected || product.isNew) && <Sparkles count={18} scale={[0.75, 0.85, 0.35]} size={2} speed={0.35} color="#ffe1a3" />}
      </group>
    </Float>
  )
}

function ProductInfoPanel({ product }: { product: Product }) {
  const side = product.position[0] > 1.5 ? -1 : 1

  return (
    <Float speed={1.2} floatIntensity={0.025} rotationIntensity={0.015}>
      <group position={[product.position[0] + side * 0.86, product.position[1] + 0.02, product.position[2] + 0.12]}>
        <RoundedBox castShadow args={[0.96, 1.08, 0.035]} radius={0.045} smoothness={6}>
          <meshStandardMaterial color="#fff2d7" roughness={0.9} />
        </RoundedBox>
        <Text position={[0, 0.42, 0.035]} fontSize={0.064} color="#5b4434" maxWidth={0.78} textAlign="center" anchorX="center">
          {product.name}
        </Text>
        <Text position={[-0.38, 0.23, 0.035]} fontSize={0.044} color="#75614f" anchorX="left">
          Current: {product.price}{'\n'}
          Lowest: {product.lowest}{'\n'}
          Quality: {product.rating}{'\n'}
          Verdict: {product.verdict}{'\n'}
          Sale: {product.saleDate}
        </Text>
        <TrendGraph values={product.graph} />
      </group>
    </Float>
  )
}

function TrendGraph({ values }: { values: number[] }) {
  return (
    <group position={[-0.3, -0.36, 0.045]}>
      {values.map((value, index) => (
        <mesh key={`${value}-${index}`} position={[index * 0.14, value * 0.22, 0]}>
          <boxGeometry args={[0.055, value * 0.42, 0.025]} />
          <meshStandardMaterial color={index === values.length - 1 ? '#8aa881' : '#bca0c9'} roughness={0.75} />
        </mesh>
      ))}
      <Text position={[0.28, -0.07, 0.02]} fontSize={0.035} color="#80644b" anchorX="center">
        price trend
      </Text>
    </group>
  )
}

function useProductTexture(product: Product) {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 384
    canvas.height = 512
    const context = canvas.getContext('2d')

    if (context) {
      const gradient = context.createLinearGradient(0, 0, 384, 512)
      gradient.addColorStop(0, product.colorA)
      gradient.addColorStop(1, product.colorB)
      context.fillStyle = '#fff8eb'
      context.fillRect(0, 0, 384, 512)
      context.fillStyle = gradient
      context.roundRect(34, 34, 316, 300, 28)
      context.fill()
      context.fillStyle = 'rgba(255,255,255,0.64)'
      context.beginPath()
      context.arc(190, 160, 76, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = '#8b6a4d'
      context.lineWidth = 8
      context.strokeRect(34, 34, 316, 300)
      context.fillStyle = '#5e4938'
      context.font = 'bold 34px serif'
      context.textAlign = 'center'
      context.fillText(product.name, 192, 390, 310)
      context.font = '28px serif'
      context.fillText(product.price, 192, 438)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return texture
  }, [product])
}

function Decorations() {
  return (
    <group>
      <GltfTag position={[-3.1, 1.16, -2.74]} rotation={[0, 0, -0.08]} />
      <Plants />
      <BooksAndBaskets />
      <FairyLights />
      <WallArt />
      <DeskLamp />
      <PlushAndCollectibles />
    </group>
  )
}

function GltfTag({
  position,
  rotation,
}: {
  position: [number, number, number]
  rotation: [number, number, number]
}) {
  const { scene } = useGLTF('/models/handwritten-tag.gltf')
  const clone = useMemo(() => scene.clone(true), [scene])

  return (
    <group position={position} rotation={rotation}>
      <primitive object={clone} scale={[0.34, 0.34, 0.34]} />
      <RoundedBox castShadow args={[0.76, 0.24, 0.035]} radius={0.035} smoothness={5}>
        <meshStandardMaterial color="#ead5ae" roughness={0.92} />
      </RoundedBox>
      <Text position={[0, 0, 0.028]} fontSize={0.052} color="#72543c" anchorX="center">
        handwritten picks
      </Text>
    </group>
  )
}

function Plants() {
  return (
    <group>
      {[
        [-3.7, 0.12, -2.55],
        [3.55, 0.12, -2.35],
        [-3.85, 1.95, -1.35],
      ].map(([x, y, z], index) => (
        <group key={`${x}-${z}`} position={[x, y, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.14, 0.18, 0.22, 18]} />
            <meshStandardMaterial color={index === 1 ? '#d8b2a4' : '#c6b285'} roughness={0.85} />
          </mesh>
          {Array.from({ length: 7 }, (_, leafIndex) => (
            <mesh
              key={leafIndex}
              castShadow
              position={[
                Math.cos(leafIndex) * 0.09,
                0.18 + leafIndex * 0.012,
                Math.sin(leafIndex * 1.7) * 0.08,
              ]}
              rotation={[0.5, leafIndex, 0.6]}
              scale={[0.06, 0.18, 0.025]}
            >
              <sphereGeometry args={[1, 12, 8]} />
              <meshStandardMaterial color="#78966f" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function BooksAndBaskets() {
  return (
    <group>
      {Array.from({ length: 9 }, (_, index) => (
        <mesh key={index} castShadow position={[-3.3 + index * 0.095, 0.73, -2.52]} rotation={[0, 0, (index % 3 - 1) * 0.08]}>
          <boxGeometry args={[0.07, 0.34 + (index % 4) * 0.025, 0.22]} />
          <meshStandardMaterial color={['#9db1bd', '#d8aa8a', '#b9c99a'][index % 3]} roughness={0.82} />
        </mesh>
      ))}
      {[-2.9, 2.9].map((x) => (
        <group key={x} position={[x, 0.18, 0.02]}>
          <RoundedBox castShadow args={[0.62, 0.3, 0.42]} radius={0.06} smoothness={6}>
            <meshStandardMaterial color="#b98958" roughness={0.96} wireframe={false} />
          </RoundedBox>
          <mesh position={[0, 0.08, 0.23]}>
            <boxGeometry args={[0.58, 0.035, 0.025]} />
            <meshStandardMaterial color="#e4c393" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function FairyLights() {
  return (
    <group position={[0, 3.15, -2.88]}>
      {Array.from({ length: 18 }, (_, index) => {
        const x = -3.4 + index * 0.4
        const y = Math.sin(index * 0.8) * 0.09

        return (
          <group key={index} position={[x, y, 0]}>
            <mesh>
              <sphereGeometry args={[0.035, 12, 8]} />
              <meshStandardMaterial color="#ffe4aa" emissive="#ffc86f" emissiveIntensity={0.75 + Math.sin(index) * 0.15} />
            </mesh>
            <pointLight color="#ffd99f" intensity={0.18} distance={0.9} />
          </group>
        )
      })}
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[7, 0.015, 0.015]} />
        <meshStandardMaterial color="#87694c" roughness={0.9} />
      </mesh>
    </group>
  )
}

function WallArt() {
  const frames: Array<[number, number, number, string]> = [
    [-3.85, 2.35, -0.8, '#c7b1d7'],
    [3.85, 2.05, -0.95, '#a8c4ad'],
  ]

  return (
    <group>
      {frames.map(([x, y, z, color]) => (
        <group key={`${x}-${z}`} position={[x, y, z]} rotation={[0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.72, 0.5, 0.045]} />
            <meshStandardMaterial color="#a77a52" roughness={0.68} />
          </mesh>
          <mesh position={[0, 0, 0.03]}>
            <boxGeometry args={[0.58, 0.36, 0.035]} />
            <meshStandardMaterial color={color} roughness={0.82} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function DeskLamp() {
  return (
    <group position={[1.12, 0.9, 0.65]}>
      <mesh castShadow position={[0, -0.22, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.035, 32]} />
        <meshStandardMaterial color="#b9824d" metalness={0.2} roughness={0.42} />
      </mesh>
      <mesh castShadow position={[0, 0.02, 0]} rotation={[0, 0, -0.45]}>
        <cylinderGeometry args={[0.025, 0.025, 0.48, 16]} />
        <meshStandardMaterial color="#b9824d" metalness={0.18} roughness={0.45} />
      </mesh>
      <mesh castShadow position={[0.18, 0.28, 0]} rotation={[0, 0, -0.32]}>
        <coneGeometry args={[0.18, 0.22, 28]} />
        <meshStandardMaterial color="#f1d8a8" emissive="#ffcd7f" emissiveIntensity={0.28} roughness={0.65} />
      </mesh>
      <pointLight color="#ffc878" intensity={1.1} distance={2} position={[0.18, 0.18, 0.08]} />
    </group>
  )
}

function PlushAndCollectibles() {
  return (
    <group position={[3.28, 0.66, -2.45]}>
      <mesh castShadow scale={[0.14, 0.19, 0.12]}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial color="#d78d68" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[-0.08, 0.16, 0]} rotation={[0, 0, 0.45]}>
        <coneGeometry args={[0.055, 0.13, 16]} />
        <meshStandardMaterial color="#d78d68" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.08, 0.16, 0]} rotation={[0, 0, -0.45]}>
        <coneGeometry args={[0.055, 0.13, 16]} />
        <meshStandardMaterial color="#d78d68" roughness={0.9} />
      </mesh>
      <mesh position={[-0.04, 0.03, 0.1]}>
        <sphereGeometry args={[0.018, 10, 8]} />
        <meshStandardMaterial color="#493b32" />
      </mesh>
      <mesh position={[0.04, 0.03, 0.1]}>
        <sphereGeometry args={[0.018, 10, 8]} />
        <meshStandardMaterial color="#493b32" />
      </mesh>
    </group>
  )
}

function FloatingDust() {
  return <Sparkles count={70} scale={[7, 3, 5]} size={1.25} speed={0.16} color="#ffe4b7" position={[0, 1.7, 0]} />
}

function ClickableGroup({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)

  return (
    <group
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onPointerOut={() => setHovered(false)}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
    >
      {children}
    </group>
  )
}

useGLTF.preload('/models/handwritten-tag.gltf')

export default App
