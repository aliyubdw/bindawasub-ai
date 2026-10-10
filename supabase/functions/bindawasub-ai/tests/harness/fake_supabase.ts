// Mock-only stand-in for @supabase/supabase-js used by the regression harness.
// It keeps tables in memory, supports the query shapes the Edge Function uses,
// records every rpc() call, and NEVER touches the network.

export type Row = Record<string, any>;

export const db: {
  tables: Record<string, Row[]>;
  rpcCalls: { name: string; args: any }[];
  rpcHandlers: Record<string, (args: any) => { data: any; error: any }>;
  authUsers: Record<string, Row>;
} = { tables: {}, rpcCalls: [], rpcHandlers: {}, authUsers: {} };

let idCounter = 0;
const nextId = () => `mock-id-${++idCounter}`;

export function resetDb(seed: Record<string, Row[]>) {
  db.tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    db.tables[name] = rows.map((row) => structuredClone(row));
  }
  db.rpcCalls = [];
  db.rpcHandlers = {};
  idCounter = 0;
}

class Query {
  private filters: ((row: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private patch: Row | Row[] | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private wantSingle: "single" | "maybe" | null = null;
  private selectAfterWrite = false;
  private conflictKey: string | null = null;

  constructor(private table: string) {}

  select(_cols?: string) {
    if (this.op !== "select") this.selectAfterWrite = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.patch = rows; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "insert"; this.patch = rows; this.conflictKey = opts?.onConflict ?? null; return this;
  }
  not(col: string, op: string, val: any) {
    if (op === "is") this.filters.push((r) => (r[col] ?? null) !== val);
    return this;
  }
  or(expr: string) {
    const parts = expr.split(",").map((e) => e.split("."));
    this.filters.push((r) => parts.some(([col, , , v]) => (v === "null" ? (r[col] ?? null) !== null : false)));
    return this;
  }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: any) { this.filters.push((r) => r[col] === val); return this; }
  neq(col: string, val: any) { this.filters.push((r) => r[col] !== val); return this; }
  in(col: string, vals: any[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  is(col: string, val: any) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  gte(col: string, val: any) { this.filters.push((r) => r[col] >= val); return this; }
  lte(col: string, val: any) { this.filters.push((r) => r[col] <= val); return this; }
  gt(col: string, val: any) { this.filters.push((r) => r[col] > val); return this; }
  lt(col: string, val: any) { this.filters.push((r) => r[col] < val); return this; }
  ilike(col: string, pattern: string) {
    const rx = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
    this.filters.push((r) => rx.test(String(r[col] ?? "")));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.max = n; return this; }
  single() { this.wantSingle = "single"; return this; }
  maybeSingle() { this.wantSingle = "maybe"; return this; }

  private run() {
    const rows = (db.tables[this.table] ||= []);
    const match = () => rows.filter((r) => this.filters.every((f) => f(r)));

    if (this.op === "insert") {
      const list = Array.isArray(this.patch) ? this.patch : [this.patch as Row];
      const inserted: Row[] = [];
      for (const r of list) {
        const existing = this.conflictKey ? rows.find((x) => x[this.conflictKey!] === r[this.conflictKey!]) : null;
        if (existing) { Object.assign(existing, r); inserted.push(existing); }
        else { const row = { id: nextId(), ...r }; rows.push(row); inserted.push(row); }
      }
      return this.finish(this.selectAfterWrite || this.wantSingle ? inserted : null);
    }
    if (this.op === "update") {
      const hit = match();
      for (const row of hit) Object.assign(row, this.patch);
      return this.finish(this.selectAfterWrite || this.wantSingle ? hit : null);
    }
    if (this.op === "delete") {
      const hit = new Set(match());
      db.tables[this.table] = rows.filter((r) => !hit.has(r));
      return this.finish(null);
    }
    let out = match();
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.max != null) out = out.slice(0, this.max);
    return this.finish(out);
  }

  private finish(rows: Row[] | null) {
    if (this.wantSingle) {
      if (!rows || rows.length === 0) {
        return this.wantSingle === "single"
          ? { data: null, error: { message: "No rows found", code: "PGRST116" } }
          : { data: null, error: null };
      }
      return { data: structuredClone(rows[0]), error: null };
    }
    return { data: rows ? structuredClone(rows) : null, error: null };
  }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    try { return Promise.resolve(this.run()).then(resolve, reject); }
    catch (e) { return Promise.reject(e).then(resolve, reject); }
  }
}

export function createClient(_url: string, _key: string) {
  return {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: any) => {
      db.rpcCalls.push({ name, args: structuredClone(args) });
      const handler = db.rpcHandlers[name];
      return Promise.resolve(handler ? handler(args) : { data: null, error: { message: `unmocked rpc ${name}` } });
    },
    auth: {
      getUser: (token: string) => {
        const user = db.authUsers[token];
        return Promise.resolve(user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "bad token" } });
      },
    },
  };
}
