// Sample file the judge SHOULD fail: SQL injection + a hardcoded secret.
import { createClient } from "./db.js";

const DB_PASSWORD = "p@ssw0rd-prod-2024"; // hardcoded secret
const client = createClient({ user: "app", password: DB_PASSWORD });

// User input is concatenated straight into SQL — classic injection.
export async function findUser(name) {
  const sql = "SELECT * FROM users WHERE name = '" + name + "'";
  return client.query(sql);
}

// No auth check: anyone who can call this reads any user's record by id.
export async function getUserById(id) {
  return client.query("SELECT * FROM users WHERE id = " + id);
}
