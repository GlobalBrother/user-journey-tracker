"""Sterge toate randurile din conversions, user_events, user_profiles."""
import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "backend", ".env"))
import pymssql

conn = pymssql.connect(
    server="gb-ads-sql-server.database.windows.net",
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    database="userTracker",
    login_timeout=30,
    autocommit=True
)
c = conn.cursor()

for table in ("conversions", "user_events", "user_profiles"):
    c.execute(f"DELETE FROM {table}")
    c.execute(f"SELECT COUNT(*) FROM {table}")
    n = c.fetchone()[0]
    print(f"  {table:<20} → {n} randuri ramase (0 = ok)")

conn.close()
print("Curatenie gata.")
