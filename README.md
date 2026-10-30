Owner: MR SURAJ

# FB Report Management Server

A small, self-hosted intake and moderation dashboard for recording reports about Facebook URLs/content. It does NOT automate Facebook reporting or mass-report accounts.

## Run
1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and change `ADMIN_KEY`.
3. Run `npm install`.
4. Run `npm start`.
5. Open http://localhost:3000

## API
POST /api/reports
- JSON: `{ "targetUrl": "...", "category": "...", "description": "...", "reporter": "optional" }`
- Or multipart/form-data with `screenshot` file.

GET /api/reports
- Requires `x-admin-key: YOUR_ADMIN_KEY`
- Optional `status`, `category`, `limit`

PATCH /api/reports/:id
- Requires `x-admin-key`
- JSON: `{ "status": "reviewing" }`

GET /api/reports/:id
- Requires `x-admin-key`

Statuses: new, reviewing, resolved, rejected
Categories: impersonation, harassment, scam, spam, intellectual_property, other
