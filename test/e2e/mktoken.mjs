// Usage: SITE=<path to an EmDash site> D1=<its local D1 sqlite> bun mktoken.mjs recovery <email> | invite <email>
// Writes a token straight into the local D1 (dev only), the same shape EmDash and this package create.
import { createRequire } from "node:module";
import { Database } from "bun:sqlite";
const SITE = process.env.SITE;
if (!SITE || !process.env.D1) throw new Error("set SITE (site project path) and D1 (local D1 sqlite path)");
const req = createRequire(SITE + "/package.json");
const { generateTokenWithHash } = await import(req.resolve("@emdash-cms/auth"));
const DB = process.env.D1;
const [type, email] = process.argv.slice(2);
const db = new Database(DB);
const dev = db.query("select id from users where email='dev@emdash.local'").get();
const { token, hash } = generateTokenWithHash();
const exp = new Date(Date.now() + 30 * 60 * 1000).toISOString();
if (type === "recovery") {
  db.query("insert into auth_tokens (hash,user_id,email,type,expires_at) values (?,?,?,?,?)").run(hash, dev.id, email, "recovery", exp);
} else {
  db.query("insert into auth_tokens (hash,user_id,email,type,role,invited_by,expires_at) values (?,?,?,?,?,?,?)").run(hash, null, email, "invite", 40, dev.id, exp);
}
console.log(token);
