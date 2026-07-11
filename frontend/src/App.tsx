import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Html,
  Sparkles,
  useAnimations,
  useCursor,
  useGLTF,
} from "@react-three/drei";
import gsap from "gsap";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import * as THREE from "three";

/* ============================================================== *
 *  BloomCart — a cozy low-poly archive for your shopping cart.
 *  You stand in the middle of the shop; each wall is a shelf of
 *  2D cards (Buy / Waiting for a Sale).
 *  Retsuko works the desk and tells you what's worth buying
 *  now vs. worth waiting on.
 *
 *  Everything is in this one file. The Chrome-extension cart
 *  capture from the team is preserved (Refresh Cart button +
 *  background polling).
 * ============================================================== */

type Shelf = "Buy" | "Waiting for a Sale";
type CameraView = "default" | "register" | "buy" | "waiting";

const API_BASE_URL = "http://localhost:8080";
const BLOOMCART_EXTENSION_ID = "naflnfaamlcdjakgmhaiggmolhceiaok";
const PRODUCT_POLL_INTERVAL_MS = 2000;
const MAX_RENDERED_PRODUCTS = 10;

const INVERT_DRAG_X = false; // set true to reverse left/right
const INVERT_DRAG_Y = false; // set true to reverse up/down

/* ------------------------- GLB props (tweak these) ------------------------- */
const DESK_MODEL_URL = "/models/desk.glb";
const RETSUKO_MODEL_URL = "/models/retsuko.glb";

const DESK_SCALE = 0.7;
const DESK_POSITION: [number, number, number] = [-0.1, 0, -1.3];
const DESK_ROTATION_Y = Math.PI / 2; // turns the long side toward the camera

const RETSUKO_SCALE = 0.4; // ~4.2-unit model -> ~1.7 in-scene
const RETSUKO_POSITION: [number, number, number] = [0, 0, -1.95]; // behind the desk
const RETSUKO_ROTATION_Y = 0; // if she's paper-thin / faces away: try Math.PI or Math.PI/2
const RETSUKO_PLAY_ANIMATION = true; // set false if the spin looks off

/* ------------------------------- data ------------------------------- */

type Product = {
  databaseId?: string;
  id: string;
  name: string;
  price: string;
  lowest: string;
  rating: string;
  verdict: string;
  saleDate: string;
  badge: string;
  shelf: Shelf;
  colorA: string;
  colorB: string;
  graph: number[];
  isNew?: boolean;
  imageUrl?: string | null;
  position?: [number, number, number];
};

type DatabaseProduct = {
  id: string;
  source_site: string;
  source_product_id: string | null;
  source_url: string | null;
  cart_url: string | null;
  name: string;
  prices: number[] | null;
  price: number | null;
  currency: string | null;
  quantity: number | null;
  image_url: string | null;
  captured_at: string | null;
  last_seen_at: string | null;
  lowest_price: number | null;
  previous_price?: number | null;
  last_checked_at?: string | null;
  price_changed_at?: string | null;
  check_error?: string | null;
  price_check_method?: string | null;
  rating: string | null;
  verdict: string | null;
  badge: string | null;
  shelf: string | null;
};

type ProductsResponse = {
  products: DatabaseProduct[];
};

type EcoSummaryResponse = {
  ok: boolean;
  cached: boolean;
  product: DatabaseProduct;
};

type ExtensionPriceCheckResponse = {
  ok: boolean;
  result?: {
    backend?: {
      priceDropped?: boolean;
      priceChanged?: boolean;
      oldPrice?: number | null;
      newPrice?: number | null;
      newCurrency?: string | null;
      name?: string;
    };
    extracted?: {
      price?: number | null;
      currency?: string | null;
      method?: string;
      rawText?: string | null;
    } | null;
    error?: string;
  };
  error?: string;
};

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: { message?: string };
        sendMessage?: (
          extensionId: string,
          message: { type: string; productId: string },
          callback: (response?: ExtensionPriceCheckResponse) => void,
        ) => void;
      };
    };
  }
}

const productPalettes = [
  ["#9cbad6", "#d9b3d7"],
  ["#dcbf91", "#879f7a"],
  ["#cbd7b3", "#f6dec8"],
  ["#c89253", "#f3dca6"],
  ["#b98d8d", "#8aa6b5"],
  ["#ead9a8", "#b5a1c8"],
  ["#d78d68", "#fff0d9"],
  ["#a6c8ba", "#e7c49b"],
  ["#c7b1d7", "#f0d7a6"],
  ["#9db1bd", "#d8aa8a"],
];

/** Each shelf lives on one wall, with its own accent + camera view. */
const SHELF_META: Record<
  Shelf,
  {
    color: string;
    view: CameraView;
    wall: "back" | "right" | "front" | "left";
    blurb: string;
  }
> = {
  Buy: {
    color: "#7bb45f",
    view: "buy",
    wall: "left",
    blurb: "Good price for the quality — grab it.",
  },
  "Waiting for a Sale": {
    color: "#e0a94e",
    view: "waiting",
    wall: "right",
    blurb: "Likely to drop soon. Hold tight.",
  },
};

const SHELF_ORDER: Shelf[] = ["Buy", "Waiting for a Sale"];

/* ----------------------------- product loading ----------------------------- */

function getStableHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function getDatabaseProducts() {
  const response = await fetch(
    `${API_BASE_URL}/products?limit=${MAX_RENDERED_PRODUCTS}`,
  );

  if (!response.ok) {
    throw new Error(`Product API returned ${response.status}`);
  }

  const payload = (await response.json()) as ProductsResponse;
  return payload.products;
}

async function generateEcoSummary(productId: string) {
  const response = await fetch(`${API_BASE_URL}/products/${productId}/eco-summary`, {
    method: "POST",
  });

  if (!response.ok) {
    let detail = `Eco summary API returned ${response.status}`;

    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Keep the HTTP status fallback when no JSON error body is available.
    }

    throw new Error(detail);
  }

  return (await response.json()) as EcoSummaryResponse;
}

function formatProductPrice(product: DatabaseProduct) {
  const resolvedPrice =
    product.price ??
    (product.prices && product.prices.length
      ? product.prices[product.prices.length - 1]
      : null);

  if (resolvedPrice === null) {
    return "Unknown";
  }

  const currencyPrefix =
    product.currency === "USD"
      ? "$"
      : product.currency
        ? `${product.currency} `
        : "";
  return `${currencyPrefix}${resolvedPrice.toFixed(2)}`;
}

function formatCapturedDate(value: string | null) {
  if (!value) {
    return "Captured";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function normalizeShelf(value: string | null): Shelf {
  if (value === "Waiting for a Sale") {
    return value;
  }

  return "Buy";
}

function buildPriceTrend(prices: number[] | null) {
  const trend = (prices ?? [])
    .filter((price) => Number.isFinite(price))
    .slice(-6);
  return trend.length ? trend : [1];
}

function shouldGenerateEcoVerdict(verdict: string) {
  const normalized = verdict.trim();
  return !normalized || normalized === "Recently captured";
}

function databaseProductsToProducts(
  databaseProducts: DatabaseProduct[],
): Product[] {
  return databaseProducts.slice(0, MAX_RENDERED_PRODUCTS).map((item, index) => {
    const price = formatProductPrice(item);
    const lowestNumericPrice =
      item.lowest_price ??
      (item.prices && item.prices.length ? Math.min(...item.prices) : null);
    const lowest =
      lowestNumericPrice === null
        ? price
        : formatProductPrice({ ...item, price: lowestNumericPrice });
    const hash = getStableHash(
      `${item.source_site}|${item.id}|${item.source_product_id ?? ""}`,
    );
    const palette = productPalettes[index % productPalettes.length];

    return {
      databaseId: item.id,
      id: `db-${hash}`,
      name: item.name,
      price,
      lowest,
      rating: item.rating || "Analyzing",
      verdict: item.verdict || "Recently captured",
      saleDate: formatCapturedDate(item.captured_at),
      badge:
        item.badge ||
        (item.quantity && item.quantity > 1 ? `Qty ${item.quantity}` : "New"),
      shelf: normalizeShelf(item.shelf),
      colorA: palette[0],
      colorB: palette[1],
      graph: buildPriceTrend(item.prices),
      isNew: true,
      imageUrl: item.image_url,
    };
  });
}

function emojiFor(name: string) {
  const n = name.toLowerCase();
  const table: [string, string][] = [
    ["sneaker", "👟"],
    ["shoe", "👟"],
    ["mug", "🍵"],
    ["matcha", "🍵"],
    ["tea", "🫖"],
    ["lamp", "💡"],
    ["rug", "🧶"],
    ["fox", "🦊"],
    ["plush", "🧸"],
    ["note", "📓"],
    ["book", "📚"],
    ["headphone", "🎧"],
    ["camera", "📷"],
    ["tote", "👜"],
    ["bag", "👜"],
    ["watch", "⌚"],
    ["candle", "🕯️"],
    ["plant", "🪴"],
  ];
  for (const [key, emoji] of table) if (n.includes(key)) return emoji;
  return "🛍️";
}

function ProductImage({
  alt,
  className,
  fallback,
  src,
}: {
  alt: string;
  className: string;
  fallback: ReactNode;
  src?: string | null;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src && failedSrc === src);

  if (!src || failed) {
    return fallback;
  }

  return (
    <img
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailedSrc(src)}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

/* ------------------------------ room metrics ------------------------------ */

const WALL = 3.6; // half-width of the room / distance to each wall
const OUT = WALL - 0.16; // card plane just inside the wall

const cameraViews: Record<
  CameraView,
  { position: THREE.Vector3; lookAt: THREE.Vector3 }
> = {
  default: {
    position: new THREE.Vector3(0, 1.52, 0.35),
    lookAt: new THREE.Vector3(0, 1.35, -3.6),
  },
  register: {
    position: new THREE.Vector3(0, 1.5, 0.7),
    lookAt: new THREE.Vector3(0, 1.05, -1.5),
  },
  waiting: {
    position: new THREE.Vector3(0, 1.55, 0),
    lookAt: new THREE.Vector3(3.6, 1.85, 0),
  },
  buy: {
    position: new THREE.Vector3(0, 1.55, 0),
    lookAt: new THREE.Vector3(-3.6, 1.85, 0),
  },
};

/** Where a card sits on its wall, given its index within that shelf. */
function wallSlot(
  wall: Shelf,
  i: number,
  total: number,
): { position: [number, number, number] } {
  const perRow = 4;
  const row = Math.floor(i / perRow);
  const col = i % perRow;
  const inRow = Math.min(perRow, total - row * perRow);
  const spread = 1.35;
  const off = (col - (inRow - 1) / 2) * spread;
  const y = 2.05 - row * 0.82;
  switch (SHELF_META[wall].wall) {
    case "back":
      return { position: [off, y, -OUT] };
    case "front":
      return { position: [-off, y, OUT] };
    case "right":
      return { position: [OUT, y, -off] };
    case "left":
      return { position: [-OUT, y, off] };
  }
}

/* ================================ app ================================ */

function App() {
  const [view, setView] = useState<CameraView>("default");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [notification, setNotification] = useState(
    "Hi! I\u2019m Sprout. Drag to look around your archive.",
  );
  const lastSignature = useRef("");

  const selected = products.find((p) => p.id === selectedId) ?? null;

  const applyDatabaseProductUpdate = useCallback((databaseProduct: DatabaseProduct) => {
    const [updatedProduct] = databaseProductsToProducts([databaseProduct]);

    if (!updatedProduct) {
      return;
    }

    setProducts((current) =>
      current.map((product) =>
        product.databaseId === databaseProduct.id ? updatedProduct : product,
      ),
    );
  }, []);

  const checkProductPrice = useCallback(async (product: Product) => {
    if (!product.databaseId) {
      console.warn(
        "BloomCart price check skipped: product is not from the database",
        product,
      );
      return;
    }

    if (!window.chrome?.runtime?.sendMessage) {
      setNotification("Price check needs the BloomCart Chrome extension.");
      return;
    }

    setNotification(
      `Opening ${product.name} in a background tab for price check...`,
    );

    window.chrome.runtime.sendMessage(
      BLOOMCART_EXTENSION_ID,
      { type: "BLOOMCART_CHECK_PRODUCT_PRICE", productId: product.databaseId },
      (response) => {
        const runtimeError = window.chrome?.runtime?.lastError?.message;
        console.log(runtimeError);

        if (runtimeError) {
          console.error(
            "BloomCart extension price check failed:",
            runtimeError,
          );
          setNotification(`Price check failed: ${runtimeError}`);
        }

        console.log("fehdkjhdjkdhsjksdahksdbdsckjcgxajgsadkdsakdasghajdjsa");
        console.log("BloomCart extension price check:", response);

        if (!response?.ok) {
          console.log(
            `Price check failed: ${response?.error ?? "unknown error"}`,
          );
          return;
        }

        const backend = response.result?.backend;

        if (backend?.priceDropped) {
          setNotification(
            `${product.name} dropped to ${backend.newCurrency ? `${backend.newCurrency} ` : ""}${backend.newPrice}.`,
          );
          return;
        }

        if (backend?.priceChanged) {
          setNotification(
            `${product.name} changed to ${backend.newCurrency ? `${backend.newCurrency} ` : ""}${backend.newPrice}.`,
          );
          return;
        }

        setNotification(`Checked ${product.name}. No price drop found.`);
      },
    );
  }, []);

  const syncDatabaseProducts = useCallback(async (manual = false) => {
    if (manual) {
      setNotification("Checking saved BloomCart products...");
    }

    let databaseProducts: DatabaseProduct[];

    try {
      databaseProducts = await getDatabaseProducts();
    } catch (error) {
      if (manual || !lastSignature.current) {
        setNotification(
          `Product database unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
      return;
    }

    if (!databaseProducts.length) {
      if (manual || !lastSignature.current) {
        setNotification("Waiting for the extension to save cart products.");
      }
      return;
    }

    const signature = JSON.stringify({
      products: databaseProducts.slice(0, MAX_RENDERED_PRODUCTS),
    });

    if (!manual && signature === lastSignature.current) {
      return;
    }

    lastSignature.current = signature;

    const capturedProducts = databaseProductsToProducts(databaseProducts);
    const visibleCount = capturedProducts.length;
    const site = databaseProducts[0]?.source_site ?? "the database";

    setProducts(capturedProducts);
    setSelectedId(null);
    setView("buy");
    setNotification(
      visibleCount
        ? `${visibleCount} saved product${visibleCount === 1 ? "" : "s"} loaded from ${site}.`
        : "No saved products found yet.",
    );
    setIsAnalyzing(true);
    window.setTimeout(() => setIsAnalyzing(false), 1200);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedId) setSelectedId(null);
      else setView("default");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void syncDatabaseProducts(), 0);
    const interval = window.setInterval(
      () => void syncDatabaseProducts(),
      PRODUCT_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [syncDatabaseProducts]);

  useEffect(() => {
    if (!selected?.databaseId || !shouldGenerateEcoVerdict(selected.verdict)) {
      return;
    }

    let cancelled = false;

    void generateEcoSummary(selected.databaseId)
      .then((response) => {
        if (cancelled) {
          return;
        }

        applyDatabaseProductUpdate(response.product);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setNotification(
          `Eco insight unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [applyDatabaseProductUpdate, selected]);

  const counts = useMemo(() => {
    const c: Record<Shelf, number> = {
      Buy: 0,
      "Waiting for a Sale": 0,
    };
    products.forEach((p) => (c[p.shelf] += 1));
    return c;
  }, [products]);

  return (
    <div className="bc-shell">
      <StyleTag />
      <Canvas
        shadows
        dpr={[1, 1.8]}
        camera={{ position: [0, 1.6, 5], fov: 40, near: 0.1, far: 60 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#efe6d2"]} />
        <fog attach="fog" args={["#efe6d2", 7, 15]} />
        <Scene
          isAnalyzing={isAnalyzing}
          products={products}
          view={view}
          setView={setView}
          onOpen={(id) => setSelectedId(id)}
        />
      </Canvas>

      {/* ---------- 2D overlay UI ---------- */}
      <header className="bc-topbar">
        <div className="bc-brand">
          <span className="bc-logo" aria-hidden>
            🐲
          </span>
          <div>
            <div className="bc-name">BloomCart</div>
            <div className="bc-tag">Is it worth it? Ask the archivist.</div>
          </div>
        </div>
        <nav className="bc-legend" aria-label="Shelves">
          {SHELF_ORDER.map((shelf) => (
            <button
              key={shelf}
              className="bc-legend-item"
              onClick={() => setView(SHELF_META[shelf].view)}
            >
              <i style={{ background: SHELF_META[shelf].color }} />
              {shelf}
              <b>{counts[shelf]}</b>
            </button>
          ))}
        </nav>
      </header>

      <div className="bc-speech">
        <span className="bc-speech-tail" aria-hidden />
        {isAnalyzing ? "Analyzing price history and quality…" : notification}
      </div>

      <div className="bc-actions">
        <button
          className="bc-btn bc-btn-primary"
          onClick={() => void syncDatabaseProducts(true)}
        >
          Refresh Products
        </button>
        <button
          className="bc-btn"
          onClick={() => {
            setSelectedId(null);
            setView("default");
          }}
        >
          Reset view
        </button>
      </div>

      <div className="bc-hint">
        Drag to look around · Click a card for details · Esc to go back
      </div>

      {!products.length && (
        <div className="bc-empty-state">
          <strong>No saved products yet</strong>
          <span>
            Open a supported cart page and let the BloomCart extension capture
            it.
          </span>
        </div>
      )}

      {selected && (
        <DetailModal
          onCheckPrice={checkProductPrice}
          onClose={() => setSelectedId(null)}
          product={selected}
        />
      )}
    </div>
  );
}

/* =============================== 3D scene =============================== */

function Scene({
  isAnalyzing,
  products,
  view,
  setView,
  onOpen,
}: {
  isAnalyzing: boolean;
  products: Product[];
  view: CameraView;
  setView: (v: CameraView) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <CameraRig view={view} />

      <ambientLight intensity={0.95} color="#fbe9c8" />
      <hemisphereLight args={["#fff2d8", "#b79a74", 0.55]} />
      <directionalLight
        castShadow
        color="#ffe0ab"
        intensity={2.2}
        position={[3.5, 6, 4]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-6, 6, 6, -6, 0.1, 20]}
        />
      </directionalLight>
      <pointLight
        color="#ffd79a"
        intensity={0.9}
        position={[0, 3, 0]}
        distance={9}
      />

      <Room />
      <WallShelves setView={setView} />
      <CardWall products={products} onOpen={onOpen} />

      <Suspense fallback={null}>
        <Desk setView={setView} />
        <Retsuko isAnalyzing={isAnalyzing} setView={setView} />
      </Suspense>

      <CornerPlants />

      <Sparkles
        count={60}
        scale={[7, 3.5, 7]}
        size={1.1}
        speed={0.12}
        color="#ffe4b7"
        position={[0, 1.9, 0]}
      />
      <ContactShadows
        opacity={0.24}
        scale={9}
        blur={2.6}
        far={5}
        position={[0, 0.01, 0]}
      />
    </>
  );
}

function CameraRig({ view }: { view: CameraView }) {
  const { camera, gl, mouse } = useThree();
  const base = useRef(new THREE.Vector3(0, 1.6, 5));
  const yaw = useRef(0);
  const pitch = useRef(0);
  const smYaw = useRef(0);
  const smPitch = useRef(0);
  const smMouse = useRef(new THREE.Vector2());
  const pos = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const par = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  const drag = useRef(false);

  useEffect(() => {
    const el = gl.domElement;
    const sens = 0.003;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = true;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      const xSign = INVERT_DRAG_X ? -1 : 1;
      const ySign = INVERT_DRAG_Y ? -1 : 1;
      yaw.current += e.movementX * sens * xSign;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - e.movementY * sens * ySign,
        -Math.PI / 3.2,
        Math.PI / 3.2,
      );
    };
    const up = (e: PointerEvent) => {
      drag.current = false;
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  useEffect(() => {
    const t = cameraViews[view];
    const d = t.lookAt.clone().sub(t.position).normalize();
    gsap.to(base.current, {
      x: t.position.x,
      y: t.position.y,
      z: t.position.z,
      duration: 1.5,
      ease: "power3.inOut",
    });
    gsap.to(yaw, {
      current: Math.atan2(d.x, -d.z),
      duration: 1.5,
      ease: "power3.inOut",
    });
    gsap.to(pitch, {
      current: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
      duration: 1.5,
      ease: "power3.inOut",
    });
  }, [view]);

  useFrame((_, delta) => {
    const mb = 1 - Math.exp(-10 * delta);
    const cb = 1 - Math.exp(-8 * delta);
    const rb = 1 - Math.exp(-12 * delta);
    smMouse.current.lerp(mouse, mb);
    smYaw.current = THREE.MathUtils.lerp(smYaw.current, yaw.current, rb);
    smPitch.current = THREE.MathUtils.lerp(smPitch.current, pitch.current, rb);
    par.current.set(smMouse.current.x * 0.02, smMouse.current.y * 0.015, 0);
    pos.current.copy(base.current).add(par.current);
    dir.current.set(
      Math.sin(smYaw.current) * Math.cos(smPitch.current),
      Math.sin(smPitch.current),
      -Math.cos(smYaw.current) * Math.cos(smPitch.current),
    );
    look.current.copy(pos.current).add(dir.current);
    camera.position.lerp(pos.current, cb);
    camera.lookAt(look.current);
  });

  return null;
}

/* ------------------------------- room shell ------------------------------- */

function Room() {
  return (
    <group>
      {/* floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[WALL * 2, WALL * 2]} />
        <meshStandardMaterial color="#d9b884" roughness={0.95} flatShading />
      </mesh>
      {/* walls (flat-shaded low-poly) */}
      {(
        [
          [0, 2, -WALL, 0],
          [0, 2, WALL, Math.PI],
          [WALL, 2, 0, -Math.PI / 2],
          [-WALL, 2, 0, Math.PI / 2],
        ] as [number, number, number, number][]
      ).map(([x, y, z, ry], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, ry, 0]} receiveShadow>
          <planeGeometry args={[WALL * 2, 4]} />
          <meshStandardMaterial
            color={i % 2 ? "#efe1c6" : "#f2e4ca"}
            roughness={0.98}
            side={THREE.DoubleSide}
            flatShading
          />
        </mesh>
      ))}
      {/* soft rug under the counter */}
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.011, -1.1]}
      >
        <circleGeometry args={[1.9, 6]} />
        <meshStandardMaterial color="#cf9f9a" roughness={0.98} flatShading />
      </mesh>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.013, -1.1]}
      >
        <circleGeometry args={[1.35, 6]} />
        <meshStandardMaterial color="#e0bdaf" roughness={0.98} flatShading />
      </mesh>
      {/* string lights near the ceiling */}
      <FairyRing />
    </group>
  );
}

function FairyRing() {
  const bulbs = 28;
  return (
    <group position={[0, 3.35, 0]}>
      {Array.from({ length: bulbs }, (_, i) => {
        const a = (i / bulbs) * Math.PI * 2;
        const r = WALL - 0.35;
        return (
          <mesh
            key={i}
            position={[
              Math.cos(a) * r,
              Math.sin(i * 0.9) * 0.05,
              Math.sin(a) * r,
            ]}
          >
            <icosahedronGeometry args={[0.04, 0]} />
            <meshStandardMaterial
              color="#ffe4aa"
              emissive="#ffc86f"
              emissiveIntensity={0.9}
              flatShading
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------------ wall shelves ------------------------------ */

function WallShelves({ setView }: { setView: (v: CameraView) => void }) {
  return (
    <group>
      {SHELF_ORDER.map((shelf) => {
        const wall = SHELF_META[shelf].wall;
        const ry =
          wall === "back"
            ? 0
            : wall === "front"
              ? Math.PI
              : wall === "right"
                ? -Math.PI / 2
                : Math.PI / 2;
        const px =
          wall === "right" ? WALL - 0.02 : wall === "left" ? -WALL + 0.02 : 0;
        const pz =
          wall === "back" ? -WALL + 0.02 : wall === "front" ? WALL - 0.02 : 0;
        return (
          <group key={shelf} position={[px, 0, pz]} rotation={[0, ry, 0]}>
            <ClickableGroup onClick={() => setView(SHELF_META[shelf].view)}>
              <ShelfLedge y={1.62} color={SHELF_META[shelf].color} />
              <ShelfLedge y={0.82} color={SHELF_META[shelf].color} />
            </ClickableGroup>
          </group>
        );
      })}
    </group>
  );
}

function ShelfLedge({ y, color }: { y: number; color: string }) {
  return (
    <group position={[0, y, 0.12]}>
      {/* plank */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[5.6, 0.1, 0.4]} />
        <meshStandardMaterial color="#d3a870" roughness={0.85} flatShading />
      </mesh>
      {/* front lip */}
      <mesh position={[0, -0.06, 0.2]}>
        <boxGeometry args={[5.6, 0.06, 0.06]} />
        <meshStandardMaterial color={color} roughness={0.8} flatShading />
      </mesh>
      {/* brackets */}
      {[-2.4, -0.8, 0.8, 2.4].map((x) => (
        <mesh key={x} position={[x, -0.16, -0.02]}>
          <boxGeometry args={[0.1, 0.22, 0.32]} />
          <meshStandardMaterial color="#b9884f" roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/* ----------------------------- 2D card wall ----------------------------- */

function CardWall({
  products,
  onOpen,
}: {
  products: Product[];
  onOpen: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const g: Record<Shelf, Product[]> = {
      Buy: [],
      "Waiting for a Sale": [],
    };
    products.forEach((p) => g[p.shelf].push(p));
    return g;
  }, [products]);

  return (
    <group>
      {SHELF_ORDER.map((shelf) => {
        const list = groups[shelf];
        const meta = SHELF_META[shelf];
        const wall = meta.wall;
        // label anchor sits above the top ledge on each wall
        const labelPos: [number, number, number] =
          wall === "back"
            ? [0, 2.7, -OUT]
            : wall === "front"
              ? [0, 2.7, OUT]
              : wall === "right"
                ? [OUT, 2.7, 0]
                : [-OUT, 2.7, 0];

        return (
          <group key={shelf}>
            <Html position={labelPos} center zIndexRange={[20, 0]}>
              <div
                className="bc-shelf-label"
                style={{ ["--accent" as string]: meta.color }}
              >
                {shelf}
                <span>{list.length}</span>
              </div>
            </Html>

            {list.map((p, i) => {
              const slot = wallSlot(shelf, i, list.length);
              return (
                <Html
                  key={p.id}
                  position={slot.position}
                  center
                  zIndexRange={[15, 0]}
                >
                  <button
                    className={`bc-card ${p.isNew ? "is-new" : ""}`}
                    style={{ ["--accent" as string]: meta.color }}
                    onClick={() => onOpen(p.id)}
                  >
                    <span
                      className="bc-card-photo"
                      style={{
                        background: `linear-gradient(135deg, ${p.colorA}, ${p.colorB})`,
                      }}
                    >
                      <ProductImage
                        alt={p.name}
                        className="bc-card-image"
                        fallback={
                          <span className="bc-card-emoji">
                            {emojiFor(p.name)}
                          </span>
                        }
                        src={p.imageUrl}
                      />
                    </span>
                    <span className="bc-card-name">{p.name}</span>
                    <span className="bc-card-foot">
                      <span className="bc-card-price">{p.price}</span>
                      <span className="bc-card-pill">{p.badge}</span>
                    </span>
                  </button>
                </Html>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

/* ---------------------------- GLB desk + Retsuko ---------------------------- */

function Desk({ setView }: { setView: (v: CameraView) => void }) {
  const { scene } = useGLTF(DESK_MODEL_URL);

  useEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [scene]);

  return (
    <ClickableGroup onClick={() => setView("register")}>
      <primitive
        object={scene}
        position={DESK_POSITION}
        rotation={[0, DESK_ROTATION_Y, 0]}
        scale={DESK_SCALE}
      />
    </ClickableGroup>
  );
}

function Retsuko({
  isAnalyzing,
  setView,
}: {
  isAnalyzing: boolean;
  setView: (v: CameraView) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(RETSUKO_MODEL_URL);
  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
  }, [scene]);

  useEffect(() => {
    if (!RETSUKO_PLAY_ANIMATION || !names.length) return;
    const action = actions[names[0]];
    if (!action) return;
    action.reset().fadeIn(0.4).play();
    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, names]);

  return (
    <ClickableGroup onClick={() => setView("register")}>
      <group
        ref={group}
        position={RETSUKO_POSITION}
        rotation={[0, RETSUKO_ROTATION_Y, 0]}
        scale={RETSUKO_SCALE}
      >
        <primitive object={scene} />
      </group>
      {isAnalyzing && (
        <Sparkles
          count={16}
          scale={[0.9, 1.3, 0.9]}
          size={2.4}
          speed={0.4}
          color="#ffe4a8"
          position={[RETSUKO_POSITION[0], RETSUKO_POSITION[1] + 1.7, RETSUKO_POSITION[2]]}
        />
      )}
    </ClickableGroup>
  );
}

useGLTF.preload(DESK_MODEL_URL);
useGLTF.preload(RETSUKO_MODEL_URL);

function CornerPlants() {
  const spots: [number, number, number][] = [
    [WALL - 0.5, 0, -WALL + 0.5],
    [-WALL + 0.5, 0, -WALL + 0.5],
    [WALL - 0.5, 0, WALL - 0.5],
    [-WALL + 0.5, 0, WALL - 0.5],
  ];
  return (
    <group>
      {spots.map(([x, , z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh castShadow position={[0, 0.16, 0]}>
            <cylinderGeometry args={[0.16, 0.2, 0.32, 6]} />
            <meshStandardMaterial
              color={i % 2 ? "#cf9f9a" : "#b98d67"}
              roughness={0.9}
              flatShading
            />
          </mesh>
          {Array.from({ length: 5 }, (_, j) => (
            <mesh
              key={j}
              castShadow
              position={[
                Math.cos(j * 1.4) * 0.1,
                0.5 + (j % 2) * 0.14,
                Math.sin(j * 1.9) * 0.1,
              ]}
              rotation={[0.4, j, 0.5]}
            >
              <coneGeometry args={[0.09, 0.4, 4]} />
              <meshStandardMaterial
                color={j % 2 ? "#6f9e63" : "#84ab6f"}
                roughness={0.9}
                flatShading
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* --------------------------- interaction helper --------------------------- */

function ClickableGroup({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {children}
    </group>
  );
}

/* ------------------------------ detail modal ------------------------------ */

function DetailModal({
  onCheckPrice,
  product,
  onClose,
}: {
  onCheckPrice: (product: Product) => void;
  product: Product;
  onClose: () => void;
}) {
  const meta = SHELF_META[product.shelf];
  const max = Math.max(...product.graph, 0.001);
  return (
    <div className="bc-modal-backdrop" onClick={onClose}>
      <div
        className="bc-modal"
        style={{ ["--accent" as string]: meta.color }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="bc-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="bc-modal-head">
          <span
            className="bc-modal-photo"
            style={{
              background: `linear-gradient(135deg, ${product.colorA}, ${product.colorB})`,
            }}
          >
            <ProductImage
              alt={product.name}
              className="bc-modal-image"
              fallback={emojiFor(product.name)}
              src={product.imageUrl}
            />
          </span>
          <div>
            <div className="bc-modal-name">{product.name}</div>
            <span className="bc-modal-pill">{product.shelf}</span>
          </div>
        </div>

        <div className="bc-modal-stats">
          <div>
            <span>Now</span>
            <b>{product.price}</b>
          </div>
          <div>
            <span>Lowest</span>
            <b>{product.lowest}</b>
          </div>
          <div>
            <span>Quality</span>
            <b>{product.rating}</b>
          </div>
          <div>
            <span>Sale</span>
            <b>{product.saleDate}</b>
          </div>
        </div>

        <div className="bc-verdict">
          “{product.verdict}” — {meta.blurb}
        </div>

        <button
          className="bc-check-price"
          onClick={() => onCheckPrice(product)}
        >
          Check price with browser
        </button>

        <div className="bc-trend">
          <div className="bc-trend-label">Price trend</div>
          <div className="bc-trend-bars">
            {product.graph.map((v, i) => (
              <span
                key={i}
                className={i === product.graph.length - 1 ? "now" : ""}
                style={{ height: `${(v / max) * 100}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ overlay css ------------------------------ */
/* ------------------------------ overlay css ------------------------------ */

function StyleTag() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@700;800;900&display=swap');

      * { box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; background: #efe6d2; }
      body { font-family: 'Nunito', system-ui, sans-serif; color: #5c4331; }

      .bc-shell { position: fixed; inset: 0; overflow: hidden; background: #efe6d2; }
      .bc-shell canvas { touch-action: none; }

      /* Animal Crossing Custom Cursor on Hoverable Elements */
      .bc-legend-item, .bc-btn, .bc-card, .bc-modal-close, .bc-check-price {
        cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M10,22 L6,24 L4,22 L4,18 L8,14 L12,14 L12,10 L10,6 L12,4 L16,4 L18,8 L18,14 L24,14 L26,16 L26,18 L24,20 L18,20 L18,22 L14,22 L10,22 Z" fill="white" stroke="%235c4331" stroke-width="2.5" stroke-linejoin="round"/></svg>'), auto !important;
      }

      /* Topbar & Branding */
      .bc-topbar { position: absolute; top: 18px; left: 18px; right: 18px; display: flex;
        align-items: flex-start; justify-content: space-between; gap: 14px; pointer-events: none; }
      .bc-brand { display: flex; align-items: center; gap: 11px; background: #fffff5;
        padding: 10px 20px; border-radius: 24px; box-shadow: 0 8px 0px rgba(92, 67, 49, 0.1);
        border: 4px solid #f6f0db; pointer-events: auto; }
      .bc-logo { font-size: 26px; }
      .bc-name { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 24px; color: #e9732f; line-height: 1; }
      .bc-tag { font-size: 13px; color: #8b7355; margin-top: 4px; font-weight: 700; }

      /* Shelf Legend Tabs */
      .bc-legend { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; pointer-events: auto; }
      .bc-legend-item { display: inline-flex; align-items: center; gap: 8px; border: none;
        background: #fffff5; color: #5c4331; font-family: 'Nunito', sans-serif;
        font-weight: 800; font-size: 13px; padding: 10px 16px; border-radius: 20px;
        box-shadow: 0 4px 0px rgba(92, 67, 49, 0.15); border: 3px solid #eaddca; transition: transform .1s; }
      .bc-legend-item:hover { transform: scale(1.05); background: #fffdf0; }
      .bc-legend-item i { width: 12px; height: 12px; border-radius: 50%; border: 2px solid rgba(0,0,0,0.1); }
      .bc-legend-item b { background: #ebdcb9; border-radius: 10px; padding: 2px 8px; font-size: 12px; color: #5c4331; }

      /* Cozy Speech Bubble */
      .bc-speech { position: absolute; left: 18px; bottom: 94px; max-width: 340px; background: #fffff5;
        color: #5c4331; font-weight: 800; font-size: 15px; padding: 16px 22px;
        border-radius: 32px 32px 32px 10px; box-shadow: 0 8px 0px rgba(92, 67, 49, 0.08); border: 4px solid #eaddca; }
      .bc-speech-tail { position: absolute; left: 24px; bottom: -12px; width: 18px; height: 18px; background: #fffff5;
        border-right: 4px solid #eaddca; border-bottom: 4px solid #eaddca; transform: rotate(45deg); }

      /* Action Buttons */
      .bc-actions { position: absolute; left: 18px; bottom: 22px; display: flex; gap: 10px; }
      .bc-btn { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 16px; border: 3px solid #eaddca; border-radius: 24px;
        padding: 10px 22px; color: #5c4331; background: #fffff5;
        box-shadow: 0 5px 0px rgba(92, 67, 49, 0.15); transition: transform .1s; }
      .bc-btn:hover { transform: translateY(-2px); box-shadow: 0 7px 0px rgba(92, 67, 49, 0.15); }
      
      /* Orange Stripe Accent Button */
      .bc-btn-primary { 
        background: repeating-linear-gradient(-45deg, #ff9e42, #ff9e42 12px, #ffb066 12px, #ffb066 24px);
        color: #ffffff; border: 3px solid #e07b22; text-shadow: 1px 1px 0px rgba(92, 67, 49, 0.4);
      }
      .bc-btn-primary:hover {
        background: repeating-linear-gradient(-45deg, #ffa852, #ffa852 12px, #ffba75 12px, #ffba75 24px);
      }

      .bc-hint { position: absolute; right: 18px; bottom: 24px; font-size: 13px; font-weight: 800; color: #8b7355;
        background: #fffff5; padding: 8px 16px; border-radius: 18px; border: 3px solid #f6f0db; }

      /* In-world labels */
      .bc-shelf-label { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 16px; white-space: nowrap;
        color: #5c4331; background: #fffff5; padding: 8px 16px; border-radius: 20px; border: 3px solid #eaddca;
        box-shadow: 0 6px 0px rgba(0,0,0,0.05); display: inline-flex; align-items: center; gap: 8px; user-select: none; }
      .bc-shelf-label span { background: var(--accent); color: #fff; font-size: 12px; border-radius: 10px; padding: 2px 8px; }

      /* In-world Cards */
      .bc-card { width: 140px; border: 4px solid #eaddca; text-align: left; font-family: 'Nunito', sans-serif;
        background: #fffff5; border-radius: 24px; padding: 10px; display: flex; flex-direction: column; gap: 6px;
        box-shadow: 0 8px 0px rgba(92, 67, 49, 0.08); transition: transform .14s; user-select: none; }
      .bc-card:hover { transform: translateY(-4px) scale(1.03); border-color: #ffb066; }
      .bc-card-photo { height: 80px; border-radius: 16px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 2px solid rgba(0,0,0,0.04); }
      .bc-card-image { width: 100%; height: 100%; object-fit: contain; display: block; padding: 6px; }
      .bc-card-emoji { font-size: 38px; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.1)); }
      .bc-card-name { font-weight: 800; font-size: 13px; color: #5c4331; line-height: 1.2;
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 32px; }
      .bc-card-foot { display: flex; align-items: center; justify-content: space-between; border-top: 2px dotted #ebdcb9; padding-top: 4px; margin-top: 2px; }
      .bc-card-price { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 16px; color: #e9732f; }
      .bc-card-pill { background: var(--accent); color: #fff; font-size: 10px; font-weight: 800; border-radius: 10px; padding: 2px 8px; }

      /* Detail Modal Overlay */
      .bc-modal-backdrop { position: absolute; inset: 0; background: rgba(92, 67, 49, 0.25); backdrop-filter: blur(2px);
        display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
      
      /* Main Animal Crossing White/Cream Speech Leaf Panel */
      .bc-modal { position: relative; width: min(440px, 92vw); background: #fffff5; border-radius: 48px; padding: 28px;
        box-shadow: 0 16px 0px rgba(92, 67, 49, 0.15); border: 6px solid #eaddca; }
      .bc-modal-close { position: absolute; top: 16px; right: 16px; border: 3px solid #ebdcb9; background: #fffff5; color: #5c4331;
        width: 34px; height: 34px; border-radius: 50%; font-weight: 900; font-size: 14px; box-shadow: 0 3px 0px rgba(0,0,0,0.05); }
      .bc-modal-close:hover { background: #ffb066; color: white; border-color: #e07b22; }
      
      /* Orange and White/Yellow Diagonal Striped Header Frame for Selected items */
      .bc-modal-head { 
        display: flex; gap: 16px; align-items: center; margin-bottom: 20px; 
        background: repeating-linear-gradient(-45deg, #ffbc42, #ffbc42 12px, #ffcc66 12px, #ffcc66 24px);
        padding: 14px; border-radius: 28px; border: 4px solid #e07b22;
      }
      .bc-modal-photo { width: 72px; height: 72px; border-radius: 20px; display: flex; align-items: center;
        justify-content: center; font-size: 38px; flex: none; overflow: hidden; background: #fffff5 !important; border: 3px solid #eaddca; }
      .bc-modal-image { width: 100%; height: 100%; object-fit: contain; display: block; padding: 6px; }
      .bc-modal-name { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 22px; color: #fffff5; text-shadow: 1.5px 1.5px 0px #5c4331; }
      .bc-modal-pill { display: inline-block; margin-top: 4px; background: #fffff5; color: #5c4331; font-weight: 800;
        font-size: 12px; border-radius: 12px; padding: 3px 12px; border: 2px solid #eaddca; }
      
      /* Dotted List Grids */
      .bc-modal-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
      .bc-modal-stats div { background: #fbf6ec; border-radius: 20px; padding: 10px 14px; border: 2px dashed #ebdcb9; }
      .bc-modal-stats span { display: block; font-size: 12px; color: #8b7355; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
      .bc-modal-stats b { font-family: 'Baloo 2', cursive; font-size: 18px; color: #e9732f; }
      
      .bc-verdict { font-size: 14px; font-weight: 700; color: #5c4331; background: #fbf6ec; border-radius: 20px;
        padding: 12px 16px; margin-bottom: 16px; border-left: 5px solid #ffbc42; }
      
      /* Big Playful Interaction Button */
      .bc-check-price { width: 100%; border: 3px solid #e07b22; border-radius: 24px; margin: 0 0 18px; padding: 12px 16px;
        color: #fffdf7; background: repeating-linear-gradient(-45deg, #ff9e42, #ff9e42 12px, #ffb066 12px, #ffb066 24px); 
        font-family: 'Baloo 2', cursive; font-size: 17px; font-weight: 800; text-shadow: 1px 1px 0px rgba(92, 67, 49, 0.4);
        box-shadow: 0 5px 0px rgba(92, 67, 49, 0.15); }
      .bc-check-price:hover { transform: translateY(-2px); box-shadow: 0 7px 0px rgba(92, 67, 49, 0.15); }
      
      .bc-trend-label { font-size: 12px; font-weight: 800; color: #8b7355; margin-bottom: 8px; }
      .bc-trend-bars { display: flex; align-items: flex-end; gap: 8px; height: 72px; background: #fbf6ec; padding: 10px; border-radius: 20px; border: 2px solid #eaddca; }
      .bc-trend-bars span { flex: 1; background: #ebdcb9; border-radius: 8px 8px 4px 4px; min-height: 8px; }
      .bc-trend-bars span.now { background: #e9732f; }

      @media (max-width: 720px) {
        .bc-legend { display: none; }
        .bc-hint { display: none; }
      }
    `}</style>
  );
}

export default App;
