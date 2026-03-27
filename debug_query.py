import pymssql
from dotenv import load_dotenv
import os

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "backend", ".env"))
conn = pymssql.connect(
    server='gb-ads-sql-server.database.windows.net',
    user=os.getenv('DB_USER'),
    password=os.getenv('DB_PASSWORD'),
    database='userTracker',
    login_timeout=30,
    autocommit=True
)
c = conn.cursor()
c.execute(
    "SELECT TOP 10 user_id, order_id, buyer_id, value, timestamp"
    " FROM conversions"
    " ORDER BY timestamp DESC"
)
rows = c.fetchall()
print("user_id              | order_id      | buyer_id    | value")
print("-" * 70)
for r in rows:
    print(f"{str(r[0]):20s} | {str(r[1]):13s} | {str(r[2]):11s} | {r[3]}")
conn.close()
