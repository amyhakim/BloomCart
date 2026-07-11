import os
import random
import time

import psycopg2

DATABASE_URL = os.environ["DATABASE_URL"]


def connect():
    return psycopg2.connect(DATABASE_URL)


while True:
    time.sleep(random.randint(30, 180))

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, prices
                    FROM products
                    ORDER BY random()
                    LIMIT 1
                """)

                row = cur.fetchone()

                if not row:
                    print("No products found.")
                    continue

                product_id, prices = row
                prices = prices or []

                if prices:
                    current = prices[-1]
                else:
                    current = random.randint(1000, 10000)

                change = random.uniform(-0.10, 0.10)
                new_price = max(1, round(current * (1 + change)))

                cur.execute(
                    """
                    UPDATE products
                    SET prices = array_append(prices, %s),
                        previous_price = %s,
                        updated_at = now(),
                        last_checked_at = now(),
                        price_changed_at = now()
                    WHERE id = %s
                    """,
                    (new_price, current, product_id),
                )

                print(f"{product_id}: {current} -> {new_price}")

    except Exception as e:
        print(e)
