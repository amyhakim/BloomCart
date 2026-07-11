import hashlib
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import psycopg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb


DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/mydb")
MAX_PRODUCTS = 10

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CapturedProduct(BaseModel):
    name: str | None = None
    price: str | int | float | Decimal | None = None
    quantity: str | int | None = None
    image: str | None = None
    imageUrl: str | None = None
    link: str | None = None
    sourceProductId: str | None = None


class CartCapture(BaseModel):
    supportedSite: str = Field(..., min_length=1)
    sourceUrl: str = Field(..., min_length=1)
    extractedAt: datetime | None = None
    productCount: int | None = None
    products: list[CapturedProduct] = Field(default_factory=list)


def get_connection():
    return psycopg.connect(DATABASE_URL)


def parse_price(value: str | int | float | Decimal | None) -> tuple[Decimal | None, str | None]:
    if value is None:
        return None, None

    text = str(value).strip()
    currency = None

    if "$" in text or "USD" in text.upper():
        currency = "USD"
    elif "€" in text or "EUR" in text.upper():
        currency = "EUR"
    elif "£" in text or "GBP" in text.upper():
        currency = "GBP"
    elif "₹" in text or "INR" in text.upper():
        currency = "INR"

    numeric = re.sub(r"[^0-9.]", "", text)
    if not numeric:
        return None, currency

    try:
        return Decimal(numeric), currency
    except InvalidOperation:
        return None, currency


def parse_quantity(value: str | int | None) -> int:
    if value is None:
        return 1

    match = re.search(r"\d+", str(value))
    if not match:
        return 1

    return max(1, int(match.group(0)))


def stable_product_id(site: str, product: CapturedProduct) -> str:
    if product.sourceProductId:
        return product.sourceProductId

    fingerprint = "|".join(
        [
            site.lower(),
            product.link or "",
            product.name or "",
        ]
    )
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24]


def serialize_product(row: dict[str, Any]) -> dict[str, Any]:
    price = row["price"]
    lowest_price = row["lowest_price"]

    return {
        **row,
        "price": float(price) if price is not None else None,
        "lowest_price": float(lowest_price) if lowest_price is not None else None,
        "captured_at": row["captured_at"].isoformat() if row["captured_at"] else None,
        "last_seen_at": row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


@app.on_event("startup")
def startup():
    with get_connection() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              source_site TEXT NOT NULL,
              source_product_id TEXT,
              source_url TEXT,
              cart_url TEXT,
              name TEXT NOT NULL,
              price NUMERIC(12, 2),
              currency TEXT,
              quantity INTEGER DEFAULT 1,
              image_url TEXT,
              captured_at TIMESTAMPTZ NOT NULL,
              last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              lowest_price NUMERIC(12, 2),
              rating TEXT,
              verdict TEXT,
              badge TEXT,
              shelf TEXT DEFAULT 'Recently Added',
              raw_product JSONB,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS products_source_identity_idx
            ON products (source_site, source_product_id)
            WHERE source_product_id IS NOT NULL
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS products_last_seen_idx ON products (last_seen_at DESC)")


@app.get("/")
def root():
    return {"message": "BloomCart API"}


@app.post("/products/capture")
def capture_products(capture: CartCapture):
    captured_at = capture.extractedAt or datetime.now(timezone.utc)
    saved_count = 0

    with get_connection() as conn:
        for index, product in enumerate(capture.products):
            if not product.name:
                continue

            price, currency = parse_price(product.price)
            quantity = parse_quantity(product.quantity)
            source_product_id = stable_product_id(capture.supportedSite, product)
            image_url = product.imageUrl or product.image
            raw_product = product.model_dump(mode="json")

            conn.execute(
                """
                INSERT INTO products (
                    source_site,
                    source_product_id,
                    source_url,
                    cart_url,
                    name,
                    price,
                    currency,
                    quantity,
                    image_url,
                    captured_at,
                    last_seen_at,
                    lowest_price,
                    rating,
                    verdict,
                    badge,
                    shelf,
                    raw_product
                )
                VALUES (
                    %(source_site)s,
                    %(source_product_id)s,
                    %(source_url)s,
                    %(cart_url)s,
                    %(name)s,
                    %(price)s,
                    %(currency)s,
                    %(quantity)s,
                    %(image_url)s,
                    %(captured_at)s,
                    now(),
                    %(lowest_price)s,
                    %(rating)s,
                    %(verdict)s,
                    %(badge)s,
                    %(shelf)s,
                    %(raw_product)s
                )
                ON CONFLICT (source_site, source_product_id)
                WHERE source_product_id IS NOT NULL
                DO UPDATE SET
                    source_url = EXCLUDED.source_url,
                    cart_url = EXCLUDED.cart_url,
                    name = EXCLUDED.name,
                    price = EXCLUDED.price,
                    currency = EXCLUDED.currency,
                    quantity = EXCLUDED.quantity,
                    image_url = EXCLUDED.image_url,
                    captured_at = EXCLUDED.captured_at,
                    last_seen_at = now(),
                    lowest_price = LEAST(COALESCE(products.lowest_price, EXCLUDED.price), COALESCE(EXCLUDED.price, products.lowest_price)),
                    badge = EXCLUDED.badge,
                    raw_product = EXCLUDED.raw_product,
                    updated_at = now()
                """,
                {
                    "source_site": capture.supportedSite,
                    "source_product_id": source_product_id,
                    "source_url": product.link,
                    "cart_url": capture.sourceUrl,
                    "name": product.name,
                    "price": price,
                    "currency": currency,
                    "quantity": quantity,
                    "image_url": image_url,
                    "captured_at": captured_at,
                    "lowest_price": price,
                    "rating": "Analyzing",
                    "verdict": "Recently captured",
                    "badge": f"Qty {quantity}" if quantity > 1 else "New",
                    "shelf": "Recently Added",
                    "raw_product": Jsonb({**raw_product, "positionIndex": index}),
                },
            )
            saved_count += 1

    return {"ok": True, "savedCount": saved_count}


@app.get("/products")
def list_products(limit: int = MAX_PRODUCTS):
    safe_limit = max(1, min(limit, MAX_PRODUCTS))

    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT
              id::text,
              source_site,
              source_product_id,
              source_url,
              cart_url,
              name,
              price,
              currency,
              quantity,
              image_url,
              captured_at,
              last_seen_at,
              lowest_price,
              rating,
              verdict,
              badge,
              shelf,
              raw_product,
              created_at,
              updated_at
            FROM products
            ORDER BY last_seen_at DESC, created_at DESC
            LIMIT %s
            """,
            (safe_limit,),
        )
        rows = cursor.fetchall()
        columns = [column.name for column in cursor.description] if cursor.description else []

    return {"products": [serialize_product(dict(zip(columns, row, strict=True))) for row in rows]}
