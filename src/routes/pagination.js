// Tiny pagination helper — keeps list endpoints fast and bounded even with
// hundreds of tenants and large message logs.
export function paginate(rows, query = {}, mapFn = (x) => x) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize).map(mapFn);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
