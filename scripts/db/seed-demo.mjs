// Seeds the demo charity (the sandbox charity onboarded in test 7) and the two
// demo accounts used by the DEMO_LOGIN buttons. Safe to re-run.
//   node --env-file=.env.local scripts/db/seed-demo.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const here = dirname(fileURLToPath(import.meta.url));
const test7 = JSON.parse(readFileSync(join(here, "..", "sandbox", ".state", "test7.json"), "utf8"));
if (!test7.trackingId || !test7.sellerMerchantId) throw new Error("test 7 state missing tracking ID or merchant ID");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("begin");
  const charity = await client.query(
    // is_demo marks the sandbox stand-in: the only charity demo reviewers may act on.
    `insert into charities (name, paypal_tracking_id, paypal_merchant_id, payments_receivable, status, is_demo)
     values ($1, $2, $3, true, 'active', true)
     on conflict (paypal_tracking_id) do update set name = excluded.name, paypal_merchant_id = excluded.paypal_merchant_id,
       payments_receivable = true, status = 'active', is_demo = true, updated_at = now()
     returning id`,
    ["Riverbend Relief - Demo charity (PayPal sandbox)", test7.trackingId, test7.sellerMerchantId],
  );
  const charityId = charity.rows[0].id;

  const upsertUser = async (email, name, role) => {
    const r = await client.query(
      `insert into users (id, email, name, role, is_demo) values (gen_random_uuid()::text, $1, $2, $3, true)
       on conflict (email) do update set name = excluded.name, role = excluded.role, is_demo = true
       returning id`,
      [email, name, role],
    );
    return r.rows[0].id;
  };
  const charityUser = await upsertUser("demo-charity@proven.test", "Demo charity admin", "member");
  await upsertUser("demo-reviewer@proven.test", "Demo reviewer", "reviewer");
  await client.query(
    `insert into memberships (user_id, charity_id, role) values ($1, $2, 'charity_admin') on conflict do nothing`,
    [charityUser, charityId],
  );
  await client.query("commit");
  console.log(`seeded: charity ${charityId} (merchant ${test7.sellerMerchantId}), demo charity admin, demo reviewer`);
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}
