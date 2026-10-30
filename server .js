require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY;
const DB_FILE = process.env.DB_FILE || "./data/reports.db";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

if (!ADMIN_KEY || ADMIN_KEY === "change-this-long-random-key") {
  console.warn("WARNING: Set a strong ADMIN_KEY in .env before production use.");
}

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_url TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    reporter TEXT,
    screenshot_path TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    admin_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined"));
app.use(express.static(path.join(__dirname, "..", "public")));

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});
app.use("/api/reports", publicLimiter);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only PNG, JPEG, or WebP screenshots are allowed."), ok);
  }
});

function admin(req, res, next) {
  const key = req.get("x-admin-key");
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const categories = new Set([
  "impersonation", "harassment", "scam", "spam", "intellectual_property", "other"
]);
const statuses = new Set(["new", "reviewing", "resolved", "rejected"]);

function validFacebookUrl(value) {
  try {
    const u = new URL(value);
    return ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com", "www.fb.com"]
      .includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

app.post("/api/reports", upload.single("screenshot"), (req, res) => {
  const { targetUrl, category, description, reporter } = req.body;

  if (!targetUrl || !validFacebookUrl(targetUrl)) {
    return res.status(400).json({ error: "A valid Facebook URL is required." });
  }
  if (!categories.has(category)) {
    return res.status(400).json({ error: "Invalid category." });
  }
  if (typeof description !== "string" || description.trim().length < 10 || description.length > 5000) {
    return res.status(400).json({ error: "Description must be 10-5000 characters." });
  }

  const screenshotPath = req.file ? path.basename(req.file.path) : null;
  const stmt = db.prepare(`
    INSERT INTO reports (target_url, category, description, reporter, screenshot_path)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    targetUrl.trim(),
    category,
    description.trim(),
    reporter ? String(reporter).trim().slice(0, 200) : null,
    screenshotPath
  );

  res.status(201).json({ id: result.lastInsertRowid, status: "new" });
});

app.get("/api/reports", admin, (req, res) => {
  const status = req.query.status;
  const category = req.query.category;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  let sql = "SELECT * FROM reports WHERE 1=1";
  const params = [];
  if (statuses.has(status)) { sql += " AND status = ?"; params.push(status); }
  if (categories.has(category)) { sql += " AND category = ?"; params.push(category); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  res.json(db.prepare(sql).all(...params));
});

app.get("/api/reports/:id", admin, (req, res) => {
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Report not found." });
  res.json(row);
});

app.patch("/api/reports/:id", admin, (req, res) => {
  const { status, adminNote } = req.body;
  if (!statuses.has(status)) return res.status(400).json({ error: "Invalid status." });
  if (adminNote !== undefined && String(adminNote).length > 5000) {
    return res.status(400).json({ error: "Admin note too long." });
  }

  const result = db.prepare(`
    UPDATE reports
    SET status = ?, admin_note = COALESCE(?, admin_note), updated_at = datetime('now')
    WHERE id = ?
  `).run(status, adminNote === undefined ? null : String(adminNote), req.params.id);

  if (!result.changes) return res.status(404).json({ error: "Report not found." });
  res.json({ ok: true });
});

app.get("/uploads/:name", admin, (req, res) => {
  const safe = path.basename(req.params.name);
  const file = path.join(UPLOAD_DIR, safe);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(path.resolve(file));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Request failed." });
});

app.listen(PORT, () => console.log(`Report server: http://localhost:${PORT}`));
