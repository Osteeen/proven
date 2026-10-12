-- Proves the schema's money and isolation rules hold at the database level.
-- Runs inside a transaction that is rolled back: leaves no data behind.
--   psql -d proven_dev -v ON_ERROR_STOP=0 -f scripts/db/verify-constraints.sql
-- Every "EXPECT FAIL" line must print an ERROR; every "EXPECT OK" must not.

BEGIN;

INSERT INTO charities (id, name, paypal_tracking_id, paypal_merchant_id, status)
VALUES ('00000000-0000-0000-0000-00000000000a', 'Charity A', 'track-a', 'MERCHANTA', 'active'),
       ('00000000-0000-0000-0000-00000000000b', 'Charity B', 'track-b', 'MERCHANTB', 'active');

INSERT INTO needs (id, charity_id, title, description, amount_cents, deadline, required_proof)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Blankets', '50 blankets',
        10000, now() + interval '10 days', '{receipt,supplier_confirmation}');

INSERT INTO donations (id, need_id, charity_id, amount_cents, create_request_id, donor_access_hash)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 10000, gen_random_uuid(), 'verify-hash');

INSERT INTO captures (id, donation_id, charity_id, amount_cents, reason, request_id)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 4000, 'booking_confirmed', gen_random_uuid());

INSERT INTO ledger_entries (id, charity_id, donation_id, capture_id, event, amount_cents, actor_type)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000c1', 'captured', 4000, 'system');

\echo '== EXPECT OK: setup rows inserted for charity A'

SAVEPOINT s;
\echo '== EXPECT FAIL: donation for charity A need, labelled as charity B (cross-charity)'
INSERT INTO donations (need_id, charity_id, amount_cents, create_request_id, donor_access_hash)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 500, gen_random_uuid(), 'verify-hash-b');
ROLLBACK TO s;

\echo '== EXPECT FAIL: capture on charity A donation, labelled as charity B'
INSERT INTO captures (donation_id, charity_id, amount_cents, reason, request_id)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000b', 100, 'delivery_proven', gen_random_uuid());
ROLLBACK TO s;

\echo '== EXPECT FAIL: ledger entry pointing at charity A capture, labelled as charity B'
INSERT INTO ledger_entries (charity_id, capture_id, event, amount_cents, actor_type)
VALUES ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'captured', 4000, 'system');
ROLLBACK TO s;

\echo '== EXPECT FAIL: captured more than the hold'
UPDATE donations SET captured_cents = 10001 WHERE id = '00000000-0000-0000-0000-0000000000d1';
ROLLBACK TO s;

\echo '== EXPECT FAIL: duplicate capture request id (double capture)'
INSERT INTO captures (donation_id, charity_id, amount_cents, reason, request_id)
SELECT donation_id, charity_id, 100, 'delivery_proven', request_id FROM captures WHERE id = '00000000-0000-0000-0000-0000000000c1';
ROLLBACK TO s;

\echo '== EXPECT FAIL: need deadline beyond the 29-day hold window'
INSERT INTO needs (charity_id, title, description, amount_cents, deadline, required_proof)
VALUES ('00000000-0000-0000-0000-00000000000a', 'Too late', 'x', 100, now() + interval '30 days', '{receipt,supplier_confirmation}');
ROLLBACK TO s;

\echo '== EXPECT FAIL: need with only one proof type'
INSERT INTO needs (charity_id, title, description, amount_cents, deadline, required_proof)
VALUES ('00000000-0000-0000-0000-00000000000a', 'One proof', 'x', 100, now() + interval '5 days', '{supplier_confirmation}');
ROLLBACK TO s;

\echo '== EXPECT FAIL: need whose proofs all come from the charity (receipt + photo)'
INSERT INTO needs (charity_id, title, description, amount_cents, deadline, required_proof)
VALUES ('00000000-0000-0000-0000-00000000000a', 'Own evidence only', 'x', 100, now() + interval '5 days', '{receipt,live_photo}');
ROLLBACK TO s;

\echo '== EXPECT FAIL: fractional or negative money is impossible (negative amount)'
INSERT INTO needs (charity_id, title, description, amount_cents, deadline, required_proof)
VALUES ('00000000-0000-0000-0000-00000000000a', 'Negative', 'x', -100, now() + interval '5 days', '{receipt,supplier_confirmation}');
ROLLBACK TO s;

\echo '== EXPECT FAIL: ledger UPDATE'
UPDATE ledger_entries SET amount_cents = 1 WHERE id = '00000000-0000-0000-0000-0000000000e1';
ROLLBACK TO s;

\echo '== EXPECT FAIL: ledger DELETE'
DELETE FROM ledger_entries WHERE id = '00000000-0000-0000-0000-0000000000e1';
ROLLBACK TO s;

\echo '== EXPECT FAIL: active charity without a PayPal merchant id'
INSERT INTO charities (name, paypal_tracking_id, status) VALUES ('No merchant', 'track-c', 'active');
ROLLBACK TO s;

\echo '== EXPECT FAIL: storing a PayPal sign-in token on an account'
INSERT INTO users (id, email) VALUES ('verify-user', 'verify@proven.test');
INSERT INTO accounts (user_id, type, provider, provider_account_id, access_token)
VALUES ('verify-user', 'oauth', 'paypal', 'VERIFYPAYER', 'not-a-real-token');
ROLLBACK TO s;

\echo '== EXPECT FAIL: refunding more than a donor was charged'
UPDATE donations SET refunded_cents = captured_cents + 1 WHERE id = '00000000-0000-0000-0000-0000000000d1';
ROLLBACK TO s;

\echo '== EXPECT FAIL: refunding more than a capture took'
INSERT INTO captures (id, donation_id, charity_id, amount_cents, reason, request_id, refunded_cents)
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 1000, 'delivery_proven', gen_random_uuid(), 1001);
ROLLBACK TO s;

\echo '== EXPECT FAIL: refund pointing at a capture from a different donation'
INSERT INTO donations (id, need_id, charity_id, amount_cents, create_request_id, donor_access_hash)
VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 5000, gen_random_uuid(), 'verify-hash-2');
INSERT INTO refunds (batch_id, need_id, capture_id, donation_id, charity_id, amount_cents, request_id, reason, requested_by)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2',
       '00000000-0000-0000-0000-00000000000a', 100, gen_random_uuid(), 'verify', id FROM users LIMIT 1;
ROLLBACK TO s;

\echo '== EXPECT OK: second partial capture on the same donation'
INSERT INTO captures (donation_id, charity_id, amount_cents, reason, request_id)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 3000, 'delivery_proven', gen_random_uuid());

ROLLBACK;
