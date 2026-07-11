import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Html,
  Sparkles,
  useCursor,
} from "@react-three/drei";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";

/* ============================================================== *
 *  BloomCart — a cozy low-poly archive for your shopping cart.
 *  You stand in the middle of the shop; each wall is a shelf of
 *  2D cards (Worth It / Waiting / Purchased / Recently Added).
 *  The dragon archivist works the island counter and tells you
 *  what's worth buying now vs. worth waiting on.
 *
 *  Everything is in this one file. The Chrome-extension cart
 *  capture from the team is preserved (Refresh Cart button +
 *  background polling).
 * ============================================================== */

type Shelf = "Worth It" | "Waiting for a Sale" | "Purchased" | "Recently Added";
type CameraView =
  | "default"
  | "register"
  | "worth"
  | "waiting"
  | "purchased"
  | "recently";

const API_BASE_URL = "http://localhost:8080";
const PRODUCT_POLL_INTERVAL_MS = 2000;
const MAX_RENDERED_PRODUCTS = 10;

/* ------------------------------- data ------------------------------- */

type Product = {
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
  price: number | null;
  currency: string | null;
  quantity: number | null;
  image_url: string | null;
  captured_at: string | null;
  last_seen_at: string | null;
  lowest_price: number | null;
  rating: string | null;
  verdict: string | null;
  badge: string | null;
  shelf: string | null;
};

type ProductsResponse = {
  products: DatabaseProduct[];
};

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
  "Worth It": {
    color: "#7bb45f",
    view: "worth",
    wall: "back",
    blurb: "Good price for the quality — grab it.",
  },
  "Waiting for a Sale": {
    color: "#e0a94e",
    view: "waiting",
    wall: "right",
    blurb: "Likely to drop soon. Hold tight.",
  },
  Purchased: {
    color: "#6f9fd8",
    view: "purchased",
    wall: "left",
    blurb: "Already yours. Nice one.",
  },
  "Recently Added": {
    color: "#a98fd0",
    view: "recently",
    wall: "front",
    blurb: "Fresh from your cart, being analyzed.",
  },
};

const SHELF_ORDER: Shelf[] = [
  "Worth It",
  "Waiting for a Sale",
  "Purchased",
  "Recently Added",
];

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
  const response = await fetch(`${API_BASE_URL}/products?limit=${MAX_RENDERED_PRODUCTS}`);

  if (!response.ok) {
    throw new Error(`Product API returned ${response.status}`);
  }

  const payload = (await response.json()) as ProductsResponse;
  return payload.products;
}

function formatProductPrice(product: DatabaseProduct) {
  if (product.price === null) {
    return "Unknown";
  }

  const currencyPrefix = product.currency === "USD" ? "$" : product.currency ? `${product.currency} ` : "";
  return `${currencyPrefix}${product.price.toFixed(2)}`;
}

function formatCapturedDate(value: string | null) {
  if (!value) {
    return "Captured";
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(new Date(value));
}

function normalizeShelf(value: string | null): Shelf {
  if (
    value === "Worth It" ||
    value === "Waiting for a Sale" ||
    value === "Purchased" ||
    value === "Recently Added"
  ) {
    return value;
  }

  return "Recently Added";
}

function databaseProductsToProducts(databaseProducts: DatabaseProduct[]): Product[] {
  return databaseProducts.slice(0, MAX_RENDERED_PRODUCTS).map((item, index) => {
    const price = formatProductPrice(item);
    const lowest = item.lowest_price === null ? price : formatProductPrice({ ...item, price: item.lowest_price });
    const hash = getStableHash(`${item.source_site}|${item.id}|${item.source_product_id ?? ""}`);
    const palette = productPalettes[index % productPalettes.length];

    return {
      id: `db-${hash}`,
      name: item.name,
      price,
      lowest,
      rating: item.rating || "Analyzing",
      verdict: item.verdict || "Recently captured",
      saleDate: formatCapturedDate(item.captured_at),
      badge: item.badge || (item.quantity && item.quantity > 1 ? `Qty ${item.quantity}` : "New"),
      shelf: normalizeShelf(item.shelf),
      colorA: palette[0],
      colorB: palette[1],
      graph: [0.68, 0.61, 0.56, 0.5, 0.45],
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
    position: new THREE.Vector3(0, 1.5, 0.55),
    lookAt: new THREE.Vector3(0, 0.72, -1.15),
  },
  worth: {
    position: new THREE.Vector3(0, 1.55, 0.2),
    lookAt: new THREE.Vector3(0, 1.85, -3.6),
  },
  waiting: {
    position: new THREE.Vector3(0, 1.55, 0),
    lookAt: new THREE.Vector3(3.6, 1.85, 0),
  },
  purchased: {
    position: new THREE.Vector3(0, 1.55, 0),
    lookAt: new THREE.Vector3(-3.6, 1.85, 0),
  },
  recently: {
    position: new THREE.Vector3(0, 1.55, 0),
    lookAt: new THREE.Vector3(0, 1.85, 3.6),
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
    setView("recently");
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

  const counts = useMemo(() => {
    const c: Record<Shelf, number> = {
      "Worth It": 0,
      "Waiting for a Sale": 0,
      Purchased: 0,
      "Recently Added": 0,
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
          <span>Open a supported cart page and let the BloomCart extension capture it.</span>
        </div>
      )}

      {selected && (
        <DetailModal product={selected} onClose={() => setSelectedId(null)} />
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
      <IslandCounter isAnalyzing={isAnalyzing} setView={setView} />
      <Dragon isAnalyzing={isAnalyzing} setView={setView} />
      <Cat position={[0.95, 0.66, -1.05]} />
      <Dog position={[-1.4, 0.0, -0.35]} />
      <Bird position={[-0.85, 0.66, -1.0]} />
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
      yaw.current -= e.movementX * sens;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - e.movementY * sens,
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
      "Worth It": [],
      "Waiting for a Sale": [],
      Purchased: [],
      "Recently Added": [],
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
                        fallback={<span className="bc-card-emoji">{emojiFor(p.name)}</span>}
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

/* ---------------------------- island counter ---------------------------- */

function IslandCounter({
  isAnalyzing,
  setView,
}: {
  isAnalyzing: boolean;
  setView: (v: CameraView) => void;
}) {
  return (
    <ClickableGroup onClick={() => setView("register")}>
      <group position={[0, 0, -1.15]}>
        {/* counter body */}
        <mesh castShadow receiveShadow position={[0, 0.32, 0]}>
          <boxGeometry args={[2.1, 0.64, 1.0]} />
          <meshStandardMaterial color="#a98fd0" roughness={0.8} flatShading />
        </mesh>
        {/* counter top */}
        <mesh castShadow position={[0, 0.67, 0]}>
          <boxGeometry args={[2.26, 0.1, 1.14]} />
          <meshStandardMaterial color="#c6b4e3" roughness={0.7} flatShading />
        </mesh>
        {/* retro monitor */}
        <group position={[0.62, 0.85, 0.05]} rotation={[0, -0.3, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.42, 0.36]} />
            <meshStandardMaterial color="#e9dcc4" roughness={0.7} flatShading />
          </mesh>
          <mesh position={[0, 0.02, 0.19]}>
            <boxGeometry args={[0.38, 0.28, 0.02]} />
            <meshStandardMaterial
              color="#20301f"
              emissive="#1c2b1b"
              emissiveIntensity={0.5}
              flatShading
            />
          </mesh>
          <Html
            position={[0, 0.02, 0.21]}
            center
            distanceFactor={2.2}
            zIndexRange={[10, 0]}
          >
            <div className="bc-crt">
              <div>QUALITY {isAnalyzing ? "████" : "██▚▚"}</div>
              <div>PRICE&nbsp;&nbsp; {isAnalyzing ? "███▚" : "██▚▚"}</div>
              <div>HYPE&nbsp;&nbsp;&nbsp; {isAnalyzing ? "██▚▚" : "█▚▚▚"}</div>
              <div className="bc-crt-grade">{isAnalyzing ? "B+" : "A"}</div>
            </div>
          </Html>
        </group>
        {/* scanner */}
        <Scanner isAnalyzing={isAnalyzing} />
        {/* mug */}
        <group position={[-0.05, 0.78, 0.32]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.08, 0.07, 0.14, 6]} />
            <meshStandardMaterial color="#c6b4e3" roughness={0.7} flatShading />
          </mesh>
        </group>
      </group>
    </ClickableGroup>
  );
}

function Scanner({ isAnalyzing }: { isAnalyzing: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ring.current) return;
    ring.current.rotation.z = s.clock.elapsedTime * 2;
    ring.current.scale.setScalar(
      1 + Math.sin(s.clock.elapsedTime * 4) * (isAnalyzing ? 0.12 : 0.03),
    );
  });
  return (
    <group position={[-0.6, 0.74, 0.05]}>
      <mesh castShadow>
        <boxGeometry args={[0.42, 0.1, 0.34]} />
        <meshStandardMaterial color="#9c7c52" roughness={0.8} flatShading />
      </mesh>
      <mesh ref={ring} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.15, 0.012, 6, 18]} />
        <meshStandardMaterial
          color={isAnalyzing ? "#ffd591" : "#e8c79d"}
          emissive={isAnalyzing ? "#ffc46d" : "#7a4f30"}
          emissiveIntensity={isAnalyzing ? 1 : 0.15}
          flatShading
        />
      </mesh>
      {isAnalyzing && (
        <Sparkles
          count={20}
          scale={[0.5, 0.5, 0.5]}
          size={2}
          speed={0.5}
          color="#ffe4a8"
          position={[0, 0.3, 0]}
        />
      )}
    </group>
  );
}

/* ------------------------- low-poly dragon (Sprout) ------------------------- */

function Dragon({
  isAnalyzing,
  setView,
}: {
  isAnalyzing: boolean;
  setView: (v: CameraView) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const lEye = useRef<THREE.Mesh>(null);
  const rEye = useRef<THREE.Mesh>(null);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 120);
    }, 3600);
    return () => window.clearInterval(id);
  }, []);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (root.current) {
      root.current.position.y = 0.66 + Math.sin(t * 1.7) * 0.02;
      root.current.rotation.z = Math.sin(t * 1.1) * 0.02;
    }
    if (head.current) {
      head.current.rotation.z = Math.sin(t * 0.7) * 0.05;
      head.current.rotation.x =
        (isAnalyzing ? 0.1 : 0) + Math.sin(t * 0.9) * 0.02;
    }
    const shift = THREE.MathUtils.clamp(
      s.camera.position.x * 0.02,
      -0.03,
      0.03,
    );
    if (lEye.current) lEye.current.position.x = -0.1 + shift;
    if (rEye.current) rEye.current.position.x = 0.1 + shift;
  });

  const G = "#93cc74";
  const GD = "#6fb257";
  const BELLY = "#d0e9b1";
  const HORN = "#c7cf63";
  const RED = "#e2473c";

  return (
    <ClickableGroup onClick={() => setView("register")}>
      {/* stands behind the counter, facing the room */}
      <group
        ref={root}
        position={[0, 0.66, -0.62]}
        rotation={[0, Math.PI, 0]}
        scale={1.05}
      >
        {/* body */}
        <mesh castShadow position={[0, -0.12, 0]} scale={[1, 1.08, 0.92]}>
          <icosahedronGeometry args={[0.34, 1]} />
          <meshStandardMaterial color={G} roughness={0.75} flatShading />
        </mesh>
        {/* belly */}
        <mesh position={[0, -0.14, -0.24]} scale={[0.6, 0.72, 0.4]}>
          <icosahedronGeometry args={[0.34, 1]} />
          <meshStandardMaterial color={BELLY} roughness={0.8} flatShading />
        </mesh>
        {/* arms */}
        {[-0.3, 0.3].map((x) => (
          <mesh
            key={x}
            castShadow
            position={[x, -0.2, -0.14]}
            scale={[0.11, 0.14, 0.11]}
          >
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={G} roughness={0.75} flatShading />
          </mesh>
        ))}
        {/* wings (flat tri membranes) */}
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            castShadow
            position={[s * 0.32, 0.0, 0.12]}
            rotation={[0.2, s * 0.6, s * -0.5]}
            scale={[0.24, 0.28, 0.02]}
          >
            <coneGeometry args={[1, 1.2, 3]} />
            <meshStandardMaterial
              color={GD}
              roughness={0.8}
              flatShading
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}

        {/* head */}
        <group ref={head} position={[0, 0.22, -0.02]}>
          <mesh castShadow scale={[1.15, 0.98, 1]}>
            <icosahedronGeometry args={[0.32, 1]} />
            <meshStandardMaterial color={G} roughness={0.72} flatShading />
          </mesh>
          {/* snout */}
          <mesh
            castShadow
            position={[0, -0.06, -0.26]}
            scale={[0.85, 0.6, 0.5]}
          >
            <icosahedronGeometry args={[0.2, 0]} />
            <meshStandardMaterial color={BELLY} roughness={0.78} flatShading />
          </mesh>
          {/* mouth */}
          <mesh position={[0, -0.12, -0.38]}>
            <boxGeometry args={[0.08, 0.012, 0.01]} />
            <meshStandardMaterial color={GD} />
          </mesh>
          {/* cheeks */}
          {[-0.19, 0.19].map((x) => (
            <mesh key={x} position={[x, -0.04, -0.2]}>
              <icosahedronGeometry args={[0.05, 0]} />
              <meshStandardMaterial
                color="#f2a9ba"
                roughness={0.8}
                flatShading
              />
            </mesh>
          ))}
          {/* eyes */}
          <mesh
            ref={lEye}
            position={[-0.1, 0.05, -0.29]}
            scale={[1, blink ? 0.12 : 1, 1]}
          >
            <icosahedronGeometry args={[0.045, 0]} />
            <meshStandardMaterial color="#2a2320" roughness={0.4} flatShading />
          </mesh>
          <mesh
            ref={rEye}
            position={[0.1, 0.05, -0.29]}
            scale={[1, blink ? 0.12 : 1, 1]}
          >
            <icosahedronGeometry args={[0.045, 0]} />
            <meshStandardMaterial color="#2a2320" roughness={0.4} flatShading />
          </mesh>
          <mesh position={[-0.085, 0.07, -0.315]}>
            <icosahedronGeometry args={[0.013, 0]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.115, 0.07, -0.315]}>
            <icosahedronGeometry args={[0.013, 0]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          {/* round red glasses */}
          {[-0.1, 0.1].map((x) => (
            <mesh
              key={x}
              position={[x, 0.05, -0.3]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <torusGeometry args={[0.085, 0.012, 6, 20]} />
              <meshStandardMaterial color={RED} roughness={0.4} flatShading />
            </mesh>
          ))}
          <mesh position={[0, 0.05, -0.3]}>
            <boxGeometry args={[0.04, 0.014, 0.01]} />
            <meshStandardMaterial color={RED} flatShading />
          </mesh>
          {/* horns */}
          <mesh castShadow position={[0, 0.34, 0]} rotation={[0.1, 0, 0]}>
            <coneGeometry args={[0.055, 0.2, 5]} />
            <meshStandardMaterial color={HORN} roughness={0.7} flatShading />
          </mesh>
          {[-0.18, 0.18].map((x) => (
            <mesh
              key={x}
              castShadow
              position={[x, 0.27, 0]}
              rotation={[0.1, 0, x < 0 ? 0.45 : -0.45]}
            >
              <coneGeometry args={[0.045, 0.16, 5]} />
              <meshStandardMaterial color={HORN} roughness={0.7} flatShading />
            </mesh>
          ))}
          {/* ear frills */}
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              castShadow
              position={[s * 0.31, 0.05, 0.02]}
              rotation={[0, 0, s * -0.9]}
            >
              <coneGeometry args={[0.05, 0.16, 4]} />
              <meshStandardMaterial color={BELLY} roughness={0.8} flatShading />
            </mesh>
          ))}
        </group>

        {/* bowtie */}
        <group position={[0, 0.02, -0.28]}>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              castShadow
              position={[s * 0.06, 0, 0]}
              rotation={[0, 0, s * 0.4 + Math.PI / 2]}
            >
              <coneGeometry args={[0.05, 0.1, 3]} />
              <meshStandardMaterial color={RED} roughness={0.5} flatShading />
            </mesh>
          ))}
          <mesh castShadow>
            <boxGeometry args={[0.04, 0.05, 0.05]} />
            <meshStandardMaterial color="#c53a31" roughness={0.5} flatShading />
          </mesh>
        </group>

        {isAnalyzing && (
          <Sparkles
            count={12}
            scale={[0.6, 0.6, 0.6]}
            size={1.6}
            speed={0.4}
            color="#ffe4a8"
            position={[0, 0.35, 0]}
          />
        )}
      </group>
    </ClickableGroup>
  );
}

/* ------------------------------ friends ------------------------------ */

function Cat({ position }: { position: [number, number, number] }) {
  const tail = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (tail.current)
      tail.current.rotation.z =
        0.3 + Math.sin(s.clock.elapsedTime * 1.6) * 0.25;
  });
  const F = "#c6b4e3";
  return (
    <group position={position} scale={0.6}>
      <mesh castShadow position={[0, -0.05, 0]} scale={[0.9, 1, 0.8]}>
        <icosahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color={F} roughness={0.85} flatShading />
      </mesh>
      <mesh castShadow position={[0, 0.28, 0.04]}>
        <icosahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color={F} roughness={0.85} flatShading />
      </mesh>
      {[-0.12, 0.12].map((x) => (
        <mesh
          key={x}
          castShadow
          position={[x, 0.46, 0.02]}
          rotation={[0, 0, x < 0 ? 0.3 : -0.3]}
        >
          <coneGeometry args={[0.07, 0.14, 4]} />
          <meshStandardMaterial color={F} roughness={0.85} flatShading />
        </mesh>
      ))}
      {[-0.08, 0.08].map((x) => (
        <mesh key={x} position={[x, 0.3, 0.2]}>
          <icosahedronGeometry args={[0.028, 0]} />
          <meshStandardMaterial color="#3a3040" flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.25, 0.22]}>
        <icosahedronGeometry args={[0.02, 0]} />
        <meshStandardMaterial color="#f2a9ba" flatShading />
      </mesh>
      <group ref={tail} position={[0.18, -0.1, -0.14]}>
        <mesh castShadow rotation={[0.6, 0, 0]} scale={[0.05, 0.05, 0.3]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={F} roughness={0.85} flatShading />
        </mesh>
      </group>
    </group>
  );
}

function Dog({ position }: { position: [number, number, number] }) {
  const B = "#e6c68b";
  const BD = "#d9b06a";
  return (
    <group position={position} scale={0.72}>
      {/* haunches / body */}
      <mesh castShadow position={[0, 0.24, 0]} scale={[0.9, 0.9, 1.05]}>
        <icosahedronGeometry args={[0.3, 0]} />
        <meshStandardMaterial color={B} roughness={0.85} flatShading />
      </mesh>
      {/* chest */}
      <mesh castShadow position={[0, 0.18, 0.26]} scale={[0.7, 0.9, 0.7]}>
        <icosahedronGeometry args={[0.24, 0]} />
        <meshStandardMaterial color={B} roughness={0.85} flatShading />
      </mesh>
      {/* head */}
      <mesh castShadow position={[0, 0.56, 0.28]}>
        <icosahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color={B} roughness={0.85} flatShading />
      </mesh>
      {/* muzzle */}
      <mesh castShadow position={[0, 0.5, 0.46]} scale={[0.55, 0.5, 0.6]}>
        <icosahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#f2e2c4" roughness={0.85} flatShading />
      </mesh>
      <mesh position={[0, 0.5, 0.6]}>
        <icosahedronGeometry args={[0.03, 0]} />
        <meshStandardMaterial color="#3a2f28" flatShading />
      </mesh>
      {/* ears (floppy) */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          castShadow
          position={[s * 0.18, 0.6, 0.24]}
          rotation={[0.2, 0, s * 0.3]}
          scale={[0.5, 1, 0.4]}
        >
          <coneGeometry args={[0.1, 0.24, 4]} />
          <meshStandardMaterial color={BD} roughness={0.85} flatShading />
        </mesh>
      ))}
      {[-0.08, 0.08].map((x) => (
        <mesh key={x} position={[x, 0.6, 0.44]}>
          <icosahedronGeometry args={[0.026, 0]} />
          <meshStandardMaterial color="#3a2f28" flatShading />
        </mesh>
      ))}
      {/* front legs */}
      {[-0.12, 0.12].map((x) => (
        <mesh
          key={x}
          castShadow
          position={[x, 0.08, 0.4]}
          scale={[0.09, 0.16, 0.09]}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={B} roughness={0.85} flatShading />
        </mesh>
      ))}
      {/* tail */}
      <mesh
        castShadow
        position={[0, 0.34, -0.28]}
        rotation={[0.7, 0, 0]}
        scale={[0.06, 0.06, 0.24]}
      >
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={BD} roughness={0.85} flatShading />
      </mesh>
    </group>
  );
}

function Bird({ position }: { position: [number, number, number] }) {
  const g = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (g.current)
      g.current.position.y =
        position[1] + Math.sin(s.clock.elapsedTime * 3) * 0.015;
  });
  return (
    <group ref={g} position={position} scale={0.5}>
      <mesh castShadow scale={[0.9, 1, 0.9]}>
        <icosahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial color="#f2d17a" roughness={0.8} flatShading />
      </mesh>
      {[-0.06, 0.06].map((x) => (
        <mesh key={x} position={[x, 0.05, 0.16]}>
          <icosahedronGeometry args={[0.025, 0]} />
          <meshStandardMaterial color="#3a3026" flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.0, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.03, 0.08, 4]} />
        <meshStandardMaterial color="#e0a94e" flatShading />
      </mesh>
      <mesh castShadow position={[0, 0.2, 0]}>
        <coneGeometry args={[0.05, 0.09, 4]} />
        <meshStandardMaterial color="#e6b45c" flatShading />
      </mesh>
    </group>
  );
}

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
  product,
  onClose,
}: {
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

function StyleTag() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@600;700;800&display=swap');

      * { box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; }
      body { font-family: 'Nunito', system-ui, sans-serif; }

      .bc-shell { position: fixed; inset: 0; overflow: hidden; background: #efe6d2; }
      .bc-shell canvas { touch-action: none; }

      /* topbar */
      .bc-topbar { position: absolute; top: 16px; left: 18px; right: 18px; display: flex;
        align-items: flex-start; justify-content: space-between; gap: 14px; pointer-events: none; }
      .bc-brand { display: flex; align-items: center; gap: 11px; background: rgba(255,253,247,0.9);
        padding: 9px 15px; border-radius: 18px; box-shadow: 0 8px 22px rgba(120,90,60,0.16);
        backdrop-filter: blur(6px); pointer-events: auto; }
      .bc-logo { font-size: 24px; }
      .bc-name { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 21px; color: #574234; line-height: 1; }
      .bc-tag { font-size: 12px; color: #7c6350; margin-top: 2px; }

      .bc-legend { display: flex; flex-wrap: wrap; gap: 7px; justify-content: flex-end; pointer-events: auto; }
      .bc-legend-item { display: inline-flex; align-items: center; gap: 7px; border: none; cursor: pointer;
        background: rgba(255,253,247,0.9); color: #574234; font-family: 'Nunito', sans-serif;
        font-weight: 700; font-size: 12.5px; padding: 8px 12px; border-radius: 14px;
        box-shadow: 0 6px 16px rgba(120,90,60,0.14); transition: transform .12s; }
      .bc-legend-item:hover { transform: translateY(-2px); }
      .bc-legend-item i { width: 11px; height: 11px; border-radius: 50%; }
      .bc-legend-item b { background: #f0e7d8; border-radius: 8px; padding: 1px 7px; font-size: 11px; }

      /* speech bubble */
      .bc-speech { position: absolute; left: 18px; bottom: 88px; max-width: 320px; background: #fffdf7;
        color: #574234; font-weight: 700; font-size: 14px; padding: 13px 17px;
        border-radius: 20px 20px 20px 6px; box-shadow: 0 10px 26px rgba(120,90,60,0.2); border: 2px solid #c6b4e3; }
      .bc-speech-tail { position: absolute; left: 20px; bottom: -9px; width: 15px; height: 15px; background: #fffdf7;
        border-right: 2px solid #c6b4e3; border-bottom: 2px solid #c6b4e3; transform: rotate(45deg); }

      /* actions + hint */
      .bc-actions { position: absolute; left: 18px; bottom: 22px; display: flex; gap: 9px; }
      .bc-btn { font-family: 'Baloo 2', cursive; font-weight: 700; font-size: 15px; border: none; border-radius: 15px;
        padding: 11px 20px; cursor: pointer; color: #574234; background: #fffdf7;
        box-shadow: 0 6px 15px rgba(120,90,60,0.18); transition: transform .12s, box-shadow .12s; }
      .bc-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(120,90,60,0.24); }
      .bc-btn-primary { background: #a98fd0; color: #fffdf7; }
      .bc-hint { position: absolute; right: 18px; bottom: 24px; font-size: 12px; font-weight: 700; color: #7c6350;
        background: rgba(255,253,247,0.7); padding: 7px 13px; border-radius: 13px; }
      .bc-empty-state { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(360px, 86vw);
        display: grid; gap: 6px; text-align: center; color: #574234; background: rgba(255,253,247,0.88);
        border: 2px solid #c6b4e3; border-radius: 22px; padding: 20px; box-shadow: 0 18px 44px rgba(120,90,60,0.22); }
      .bc-empty-state strong { font-family: 'Baloo 2', cursive; font-size: 22px; }
      .bc-empty-state span { font-size: 13px; font-weight: 700; color: #7c6350; }

      /* shelf label (in-world, via Html) */
      .bc-shelf-label { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 15px; white-space: nowrap;
        color: #574234; background: #fffdf7; padding: 6px 13px; border-radius: 13px; border-bottom: 3px solid var(--accent);
        box-shadow: 0 6px 16px rgba(120,90,60,0.2); display: inline-flex; align-items: center; gap: 8px; user-select: none; }
      .bc-shelf-label span { background: var(--accent); color: #fff; font-size: 11px; border-radius: 8px; padding: 1px 7px; }

      /* 2D product card (in-world, via Html) */
      .bc-card { width: 132px; border: none; text-align: left; cursor: pointer; font-family: 'Nunito', sans-serif;
        background: #fffdf7; border-radius: 15px; padding: 9px; display: flex; flex-direction: column; gap: 6px;
        box-shadow: 0 8px 20px rgba(120,90,60,0.22); border-top: 4px solid var(--accent);
        transition: transform .14s, box-shadow .14s; user-select: none; }
      .bc-card:hover { transform: translateY(-4px) scale(1.03); box-shadow: 0 14px 26px rgba(120,90,60,0.28); }
      .bc-card.is-new { animation: bcpop .5s ease; }
      @keyframes bcpop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      .bc-card-photo { height: 74px; border-radius: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .bc-card-image { width: 100%; height: 100%; object-fit: contain; display: block; padding: 6px; }
      .bc-card-emoji { font-size: 34px; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.15)); }
      .bc-card-name { font-weight: 800; font-size: 12.5px; color: #574234; line-height: 1.15;
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 29px; }
      .bc-card-foot { display: flex; align-items: center; justify-content: space-between; }
      .bc-card-price { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 15px; color: #574234; }
      .bc-card-pill { background: var(--accent); color: #fff; font-size: 10px; font-weight: 800; border-radius: 8px; padding: 2px 7px; }

      /* CRT readout */
      .bc-crt { font-family: 'Baloo 2', monospace; font-weight: 700; color: #8ff08a; font-size: 9px; line-height: 1.5;
        letter-spacing: 0.5px; white-space: nowrap; position: relative; user-select: none; }
      .bc-crt-grade { position: absolute; right: -6px; top: 4px; font-size: 20px; }

      /* detail modal */
      .bc-modal-backdrop { position: absolute; inset: 0; background: rgba(60,45,35,0.32); backdrop-filter: blur(3px);
        display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; animation: bcfade .2s ease; }
      @keyframes bcfade { from { opacity: 0; } to { opacity: 1; } }
      .bc-modal { position: relative; width: min(380px, 92vw); background: #fffdf7; border-radius: 24px; padding: 22px;
        box-shadow: 0 24px 60px rgba(60,45,35,0.35); border-top: 6px solid var(--accent); animation: bcrise .25s ease; }
      @keyframes bcrise { from { transform: translateY(14px) scale(0.97); opacity: 0; } to { transform: none; opacity: 1; } }
      .bc-modal-close { position: absolute; top: 14px; right: 14px; border: none; background: #f0e7d8; color: #574234;
        width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-weight: 800; }
      .bc-modal-head { display: flex; gap: 14px; align-items: center; margin-bottom: 16px; }
      .bc-modal-photo { width: 66px; height: 66px; border-radius: 16px; display: flex; align-items: center;
        justify-content: center; font-size: 34px; flex: none; overflow: hidden; }
      .bc-modal-image { width: 100%; height: 100%; object-fit: contain; display: block; padding: 6px; }
      .bc-modal-name { font-family: 'Baloo 2', cursive; font-weight: 800; font-size: 20px; color: #574234; }
      .bc-modal-pill { display: inline-block; margin-top: 5px; background: var(--accent); color: #fff; font-weight: 800;
        font-size: 11px; border-radius: 9px; padding: 3px 10px; }
      .bc-modal-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-bottom: 14px; }
      .bc-modal-stats div { background: #f7efe1; border-radius: 12px; padding: 9px 12px; }
      .bc-modal-stats span { display: block; font-size: 11px; color: #9a8570; font-weight: 700; }
      .bc-modal-stats b { font-family: 'Baloo 2', cursive; font-size: 17px; color: #574234; }
      .bc-verdict { font-size: 13px; font-weight: 700; color: #6b5443; background: #f7efe1; border-radius: 12px;
        padding: 10px 13px; margin-bottom: 14px; }
      .bc-trend-label { font-size: 11px; font-weight: 800; color: #9a8570; margin-bottom: 6px; }
      .bc-trend-bars { display: flex; align-items: flex-end; gap: 6px; height: 68px; }
      .bc-trend-bars span { flex: 1; background: #d8c6e6; border-radius: 6px 6px 3px 3px; min-height: 6px; }
      .bc-trend-bars span.now { background: var(--accent); }

      @media (max-width: 720px) {
        .bc-legend { display: none; }
        .bc-hint { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .bc-card, .bc-btn, .bc-legend-item { transition: none; }
        .bc-card.is-new, .bc-modal, .bc-modal-backdrop { animation: none; }
      }
    `}</style>
  );
}

export default App;
