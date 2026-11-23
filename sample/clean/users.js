// Sample file the judge SHOULD pass: parameterized queries, secret from env, authz check.
import { createClient } from "./db.js";

const client = createClient({
  user: "app",
  password: process.env.DB_PASSWORD, // secret from the environment, never in code
});

// Parameterized query — user input is bound, not concatenated.
export async function findUser(name) {
  return client.query("SELECT * FROM users WHERE name = $1", [name]);
}

// Caller identity is checked before returning another user's record.
export async function getUserById(requester, id) {
  if (requester.id !== id && requester.role !== "admin") {
    throw new Error("forbidden");
  }
  return client.query("SELECT * FROM users WHERE id = $1", [id]);
}
