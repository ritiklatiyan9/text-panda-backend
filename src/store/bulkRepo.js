// ---------------------------------------------------------------------------
// Direct Postgres repository for HIGH-VOLUME bulk rows (list_contacts,
// campaign_recipients). These are never loaded into the in-memory working set —
// they're queried/streamed in batches so the platform stays light even with
// very large lists. All functions are async.
// ---------------------------------------------------------------------------
import { getPool } from "../db/pool.js";

const CHUNK = 500;

// Bulk-insert rows via chunked multi-row INSERTs.
async function bulkInsert(sql, rows, toParams, colsPerRow) {
  if (!rows.length) return 0;
  const pool = getPool();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    slice.forEach((row, r) => {
      const ph = [];
      const p = toParams(row);
      p.forEach((val, c) => {
        params.push(val);
        ph.push(`$${r * colsPerRow + c + 1}`);
      });
      values.push(`(${ph.join(",")})`);
    });
    await pool.query(`${sql} VALUES ${values.join(",")}`, params);
    inserted += slice.length;
  }
  return inserted;
}

// --- Contacts ---------------------------------------------------------------
export function insertContacts(listId, tenantId, contacts) {
  return bulkInsert(
    "INSERT INTO list_contacts (list_id, tenant_id, phone, name, vars)",
    contacts,
    (c) => [listId, tenantId, c.phone, c.name || null, JSON.stringify(c.vars || {})],
    5,
  );
}

export async function getContacts(listId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await getPool().query(
    "SELECT phone, name, vars FROM list_contacts WHERE list_id = $1 ORDER BY id LIMIT $2 OFFSET $3",
    [listId, limit, offset],
  );
  return rows;
}

// --- Campaign recipients ----------------------------------------------------
export function insertRecipients(campaignId, tenantId, recipients) {
  return bulkInsert(
    "INSERT INTO campaign_recipients (campaign_id, tenant_id, phone, name, vars)",
    recipients,
    (r) => [campaignId, tenantId, r.phone, r.name || null, JSON.stringify(r.vars || {})],
    5,
  );
}

// Copy a saved list's contacts straight into a campaign (server-side, no
// round-trip) — efficient even for very large lists.
export async function copyListToCampaign(campaignId, listId) {
  const { rowCount } = await getPool().query(
    `INSERT INTO campaign_recipients (campaign_id, tenant_id, phone, name, vars)
     SELECT $1, tenant_id, phone, name, vars FROM list_contacts WHERE list_id = $2`,
    [campaignId, listId],
  );
  return rowCount;
}

export async function fetchPending(campaignId, limit) {
  const { rows } = await getPool().query(
    "SELECT id, phone, name, vars FROM campaign_recipients WHERE campaign_id = $1 AND status = 'pending' ORDER BY id LIMIT $2",
    [campaignId, limit],
  );
  return rows;
}

export async function markRecipient(id, status, error = null) {
  await getPool().query(
    "UPDATE campaign_recipients SET status = $2, error = $3, sent_at = now() WHERE id = $1",
    [id, status, error],
  );
}

export async function recipientCounts(campaignId) {
  const { rows } = await getPool().query(
    "SELECT status, count(*)::int AS n FROM campaign_recipients WHERE campaign_id = $1 GROUP BY status",
    [campaignId],
  );
  const out = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  rows.forEach((r) => { out[r.status] = r.n; });
  return out;
}

export async function recipientSample(campaignId, limit = 25) {
  const { rows } = await getPool().query(
    "SELECT phone, name, status, error, sent_at FROM campaign_recipients WHERE campaign_id = $1 ORDER BY (status='pending'), id LIMIT $2",
    [campaignId, limit],
  );
  return rows;
}

export async function countPending(campaignId) {
  const { rows } = await getPool().query(
    "SELECT count(*)::int AS n FROM campaign_recipients WHERE campaign_id = $1 AND status = 'pending'",
    [campaignId],
  );
  return rows[0].n;
}
