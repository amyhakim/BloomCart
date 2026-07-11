import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Float, RoundedBox, Text, useCursor } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import "./App.css";

type Shelf = "Worth It" | "Waiting for a Sale" | "Purchased" | "Recently Added";

type Product = {
  id: string;
  name: string;
  price: string;
  shelf: Shelf;
  colorA: string;
  colorB: string;
};

const SHELF_ORDER: Shelf[] = ["Worth It", "Waiting for a Sale", "Purchased", "Recently Added"];

const SHELF_META: Record<
  Shelf,
  {
    label: string;
    color: string;
    position: [number, number, number];
  }
> = {
  "Worth It": {
    label: "Worth It",
    color: "#93c875",
    position: [-2.65, 0.18, -2.55],
  },
  "Waiting for a Sale": {
    label: "Waiting",
    color: "#e8bb63",
    position: [-0.88, 0.18, -2.55],
  },
  Purchased: {
    label: "Purchased",
    color: "#82b6df",
    position: [0.88, 0.18, -2.55],
  },
  "Recently Added": {
    label: "New Finds",
    color: "#b99cd9",
    position: [2.65, 0.18, -2.55],
  },
};

const products: Product[] = [
  {
    id: "retro-sneakers",
    name: "Retro Sneakers",
    price: "$89",
    shelf: "Worth It",
    colorA: "#b7c7e2",
    colorB: "#8aa6c9",
  },
  {
    id: "matcha-mug",
    name: "Matcha Mug",
    price: "$22",
    shelf: "Worth It",
    colorA: "#cbd7b3",
    colorB: "#8fae7d",
  },
  {
    id: "reading-lamp",
    name: "Reading Lamp",
    price: "$78",
    shelf: "Waiting for a Sale",
    colorA: "#f3dca6",
    colorB: "#c89253",
  },
  {
    id: "mini-rug",
    name: "Mini Rug",
    price: "$96",
    shelf: "Waiting for a Sale",
    colorA: "#c9a5a5",
    colorB: "#8aa6b5",
  },
  {
    id: "fox-plush",
    name: "Fox Plush",
    price: "$19",
    shelf: "Purchased",
    colorA: "#e6b391",
    colorB: "#d78d68",
  },
  {
    id: "paper-notes",
    name: "Paper Notes",
    price: "$12",
    shelf: "Recently Added",
    colorA: "#ead9a8",
    colorB: "#b5a1c8",
  },
  {
    id: "basket",
    name: "Woven Basket",
    price: "$31",
    shelf: "Recently Added",
    colorA: "#d6b47d",
    colorB: "#a77b4e",
  },
  {
    id: "garden-clock",
    name: "Garden Clock",
    price: "$44",
    shelf: "Purchased",
    colorA: "#b5d4c6",
    colorB: "#84af9d",
  },
];

function App() {
  return (
    <main className="app-shell">
      <div className="world-frame">
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: [0, 1.55, 7.15], fov: 40, near: 0.1, far: 80 }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={["#bfe8d0"]} />
          <Suspense fallback={null}>
            <AnimalCrossingArchive />
          </Suspense>
        </Canvas>
      </div>
    </main>
  );
}

function AnimalCrossingArchive() {
  return (
    <>
      <CameraRig />
      <ambientLight intensity={1.6} color="#fff7df" />
      <directionalLight castShadow color="#ffe0a3" intensity={2.8} position={[-3, 5.6, 4.2]} shadow-mapSize={[2048, 2048]} />
      <pointLight color="#ffdca5" intensity={1.2} position={[0, 2.2, 1.5]} distance={5} />
      <RoomShell />
      <ShelfRow />
      <AnimalCrossingDesk />
      <BloomCartEntryCard />
      <ContactShadows opacity={0.3} scale={8} blur={2.4} far={4.2} position={[0, 0.012, 0]} />
    </>
  );
}

function CameraRig() {
  const { camera, mouse } = useThree();
  const basePosition = useRef(new THREE.Vector3(0, 1.55, 7.15));
  const baseLookAt = useRef(new THREE.Vector3(0, 1.08, -1.55));
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredLookAt = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  const mouseOffset = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const blend = 1 - Math.exp(-6.8 * delta);
    mouseOffset.current.set(mouse.x * 0.14, mouse.y * 0.08, 0);
    desiredPosition.current.copy(basePosition.current).add(mouseOffset.current);
    desiredLookAt.current.copy(baseLookAt.current).add(new THREE.Vector3(mouse.x * 0.08, mouse.y * 0.05, 0));

    camera.position.lerp(desiredPosition.current, blend);
    lookAt.current.lerp(desiredLookAt.current, blend);
    camera.lookAt(lookAt.current);
  });

  return null;
}

function RoomShell() {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[8.4, 7.2]} />
        <meshStandardMaterial color="#9bd279" roughness={0.9} />
      </mesh>
      <mesh receiveShadow position={[0, 2, -3.05]}>
        <boxGeometry args={[8.4, 4, 0.18]} />
        <meshStandardMaterial color="#f4dfbd" roughness={0.86} />
      </mesh>
      <mesh receiveShadow position={[-4.1, 2, 0]}>
        <boxGeometry args={[0.18, 4, 7.2]} />
        <meshStandardMaterial color="#e9cfaa" roughness={0.9} />
      </mesh>
      <EntryTrim />
      <RoundedBox receiveShadow args={[3.5, 0.035, 2.1]} radius={0.08} smoothness={5} position={[0, 0.028, 1.1]}>
        <meshStandardMaterial color="#d7a86d" roughness={0.82} />
      </RoundedBox>
      {[-1.35, -0.68, 0, 0.68, 1.35].map((x) => (
        <mesh key={x} position={[x, 0.052, 1.1]}>
          <boxGeometry args={[0.035, 0.012, 1.95]} />
          <meshStandardMaterial color="#f0cc93" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function EntryTrim() {
  return (
    <group position={[3.58, 0, 0]}>
      <mesh castShadow receiveShadow position={[0, 1.98, -2.05]}>
        <boxGeometry args={[0.22, 3.96, 2.08]} />
        <meshStandardMaterial color="#e9cfaa" roughness={0.9} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 1.98, 2.55]}>
        <boxGeometry args={[0.22, 3.96, 1.78]} />
        <meshStandardMaterial color="#e9cfaa" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 3.72, 0.6]}>
        <boxGeometry args={[0.26, 0.32, 2.9]} />
        <meshStandardMaterial color="#d8b480" roughness={0.78} />
      </mesh>
    </group>
  );
}

function ShelfRow() {
  return (
    <group>
      {SHELF_ORDER.map((shelf) => (
        <AnimalShelf key={shelf} shelf={shelf} products={products.filter((product) => product.shelf === shelf)} />
      ))}
    </group>
  );
}

function AnimalShelf({ shelf, products }: { shelf: Shelf; products: Product[] }) {
  const meta = SHELF_META[shelf];

  return (
    <group position={meta.position}>
      <RoundedBox castShadow receiveShadow args={[1.52, 1.88, 0.46]} radius={0.08} smoothness={6}>
        <meshStandardMaterial color="#c4864d" roughness={0.65} />
      </RoundedBox>
      <RoundedBox position={[0, 0.88, 0.27]} args={[1.2, 0.22, 0.08]} radius={0.04} smoothness={5}>
        <meshStandardMaterial color={meta.color} roughness={0.72} />
      </RoundedBox>
      <Text position={[0, 0.89, 0.325]} fontSize={0.07} color="#5d3d2c" anchorX="center" anchorY="middle">
        {meta.label}
      </Text>

      {[-0.28, 0.28].map((y) => (
        <mesh key={y} position={[0, y, 0.28]}>
          <boxGeometry args={[1.36, 0.08, 0.22]} />
          <meshStandardMaterial color="#e2b878" roughness={0.74} />
        </mesh>
      ))}

      {products.map((product, index) => (
        <ShelfItem key={product.id} product={product} slot={index} />
      ))}
    </group>
  );
}

function ShelfItem({ product, slot }: { product: Product; slot: number }) {
  const [hovered, setHovered] = useState(false);
  const group = useRef<THREE.Group>(null);
  const texture = useProductTexture(product);
  const x = slot % 2 === 0 ? -0.34 : 0.34;
  const y = slot < 2 ? 0.44 : -0.12;

  useCursor(hovered);

  useFrame((state) => {
    if (!group.current) return;
    group.current.position.y = y + Math.sin(state.clock.elapsedTime * 1.6 + slot) * 0.025;
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.8 + slot) * 0.06;
    group.current.scale.lerp(new THREE.Vector3(hovered ? 1.12 : 1, hovered ? 1.12 : 1, hovered ? 1.12 : 1), 0.15);
  });

  return (
    <Float speed={1.2} floatIntensity={0.04} rotationIntensity={0.025}>
      <group
        ref={group}
        position={[x, y, 0.38]}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <RoundedBox castShadow args={[0.46, 0.56, 0.08]} radius={0.06} smoothness={5}>
          <meshStandardMaterial map={texture} color="#fff8df" roughness={0.78} />
        </RoundedBox>
        <Text position={[0, -0.38, 0.08]} fontSize={0.045} color="#5f3f2d" maxWidth={0.5} textAlign="center" anchorX="center">
          {product.price}
        </Text>
      </group>
    </Float>
  );
}

function BloomCartEntryCard() {
  const card = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!card.current) return;
    card.current.position.y = 1.92 + Math.sin(state.clock.elapsedTime * 1.25) * 0.015;
  });

  return (
    <group ref={card} position={[0, 1.92, 2.55]} rotation={[0, 0, 0]}>
      <RoundedBox castShadow args={[2.7, 1.5, 0.08]} radius={0.12} smoothness={8}>
        <meshStandardMaterial color="#1f1f24" roughness={0.62} transparent opacity={0.9} />
      </RoundedBox>
      <RoundedBox position={[0, 0.47, 0.065]} args={[2.34, 0.28, 0.035]} radius={0.08} smoothness={6}>
        <meshStandardMaterial color="#303037" roughness={0.58} />
      </RoundedBox>
      <Text position={[0, 0.48, 0.095]} fontSize={0.14} color="#fff7e8" anchorX="center" anchorY="middle" letterSpacing={0.05}>
        BloomCart 🌸
      </Text>
      <Text position={[0, 0.1, 0.095]} fontSize={0.075} color="#d9d2c6" anchorX="center" anchorY="middle" maxWidth={2.1} textAlign="center">
        Step inside your cozy shopping archive.
      </Text>
      <RoundedBox position={[0, -0.38, 0.075]} args={[1.16, 0.25, 0.045]} radius={0.12} smoothness={8}>
        <meshStandardMaterial color="#fff4df" roughness={0.55} />
      </RoundedBox>
      <Text position={[0, -0.38, 0.11]} fontSize={0.065} color="#3c3027" anchorX="center" anchorY="middle">
        Shelf View
      </Text>
      <mesh position={[0, -0.68, 0.08]}>
        <torusGeometry args={[0.035, 0.006, 8, 24]} />
        <meshStandardMaterial color="#fff7e8" roughness={0.45} />
      </mesh>
    </group>
  );
}

function useProductTexture(product: Product) {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 320;
    const context = canvas.getContext("2d");

    if (context) {
      const gradient = context.createLinearGradient(0, 0, 256, 320);
      gradient.addColorStop(0, product.colorA);
      gradient.addColorStop(1, product.colorB);
      context.fillStyle = "#fff8df";
      context.fillRect(0, 0, 256, 320);
      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(24, 22, 208, 180, 24);
      context.fill();
      context.fillStyle = "rgba(255,255,255,0.72)";
      context.beginPath();
      context.arc(128, 112, 54, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#5d3d2c";
      context.font = "bold 24px serif";
      context.textAlign = "center";
      context.fillText(product.name, 128, 246, 210);
      context.font = "22px serif";
      context.fillText(product.price, 128, 282);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [product]);
}

function AnimalCrossingDesk() {
  return (
    <group position={[0, 0, 0.96]}>
      <RoundedBox castShadow receiveShadow args={[2.45, 0.82, 0.92]} radius={0.12} smoothness={7} position={[0, 0.44, 0]}>
        <meshStandardMaterial color="#b87443" roughness={0.72} />
      </RoundedBox>
      <RoundedBox castShadow receiveShadow args={[2.62, 0.12, 1.05]} radius={0.08} smoothness={6} position={[0, 0.9, 0]}>
        <meshStandardMaterial color="#d69a5d" roughness={0.65} />
      </RoundedBox>
      {[-0.78, 0, 0.78].map((x) => (
        <RoundedBox key={x} args={[0.5, 0.28, 0.035]} radius={0.025} smoothness={4} position={[x, 0.47, 0.47]}>
          <meshStandardMaterial color="#c88952" roughness={0.7} />
        </RoundedBox>
      ))}
      <Register />
    </group>
  );
}

function Register() {
  return (
    <group position={[0, 0.98, 0.06]}>
      <RoundedBox castShadow args={[0.58, 0.24, 0.44]} radius={0.05} smoothness={5}>
        <meshStandardMaterial color="#f3ead7" roughness={0.7} />
      </RoundedBox>
      <RoundedBox castShadow args={[0.46, 0.28, 0.08]} radius={0.035} smoothness={5} position={[0, 0.22, -0.13]} rotation={[-0.18, 0, 0]}>
        <meshStandardMaterial color="#7aa0a6" roughness={0.55} />
      </RoundedBox>
      <Text position={[0, 0.225, -0.075]} rotation={[-0.18, 0, 0]} fontSize={0.05} color="#fff8df" anchorX="center" anchorY="middle">
        BloomCart
      </Text>
      <RoundedBox args={[0.38, 0.07, 0.22]} radius={0.03} smoothness={4} position={[0, 0.15, 0.2]}>
        <meshStandardMaterial color="#dfc6a5" roughness={0.74} />
      </RoundedBox>
      {[-0.12, 0, 0.12].map((x) => (
        <mesh key={x} position={[x, 0.2, 0.2]}>
          <boxGeometry args={[0.055, 0.025, 0.045]} />
          <meshStandardMaterial color="#7f654b" roughness={0.72} />
        </mesh>
      ))}
      <mesh castShadow position={[0.38, 0.13, 0.12]}>
        <cylinderGeometry args={[0.09, 0.12, 0.09, 24]} />
        <meshStandardMaterial color="#e7b85e" metalness={0.12} roughness={0.46} />
      </mesh>
    </group>
  );
}

export default App;
