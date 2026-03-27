"""Query Azure to verify cross-site (fbclid) and cross-browser (buyer_id) identity resolution."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
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

print("=" * 60)
print("TEST 1 — fbclid cross-site identity resolution")
print("Expected: ALL 3 rows → user_id = 'cs_user_site_a'")
print("=" * 60)
c.execute("""
    SELECT user_id, domain, slug, fbclid, CONVERT(varchar, timestamp, 120) AS ts
    FROM user_events
    WHERE fbclid = 'FBCLID_CROSSSITE_TEST_001'
    ORDER BY timestamp
""")
rows = c.fetchall()
if rows:
    for r in rows:
        check = "✓" if r[0] == "cs_user_site_a" else "✗ FAIL"
        print(f"  {check}  user_id={r[0]:<25}  domain={r[1]:<25}  slug={r[2]}")
else:
    print("  ⚠ No rows found — fbclid may not have been stored yet")

print()
print("=" * 60)
print("TEST 2 — buyer_id cross-browser identity resolution")
print("Expected: CLEAN_A2 → user_id = 'clean_userA_safari'")
print("=" * 60)
c.execute("""
    SELECT user_id, order_id, buyer_id, value, CONVERT(varchar, timestamp, 120) AS ts
    FROM conversions
    WHERE order_id IN ('CLEAN_A1', 'CLEAN_A2', 'CLEAN_B1')
    ORDER BY timestamp
""")
rows = c.fetchall()
for r in rows:
    if r[1] == "CLEAN_A2":
        check = "✓" if r[0] == "clean_userA_safari" else "✗ FAIL"
    elif r[1] == "CLEAN_B1":
        check = "✓" if r[0] == "clean_userB_chrome" else "✗ FAIL"
    else:
        check = "✓"
    print(f"  {check}  order={r[1]:<12}  user_id={r[0]:<25}  buyer={r[2]}")

conn.close()
print()
print("Done.")
