import { requireAdmin } from '../lib/adminAuth.js';
import { loadAdminOverview } from '../lib/adminOverview.js';
import { applyCors } from '../lib/httpSecurity.js';

const cors = (req, res) => applyCors(req, res, 'GET, OPTIONS');

export function adminOverviewOptionsHandler(req, res) {
  cors(req, res);
  res.status(204).end();
}

export async function adminOverviewHandler(req, res) {
  cors(req, res);
  const adminUser = await requireAdmin(req, res);
  if (!adminUser) return;
  try {
    const overview = await loadAdminOverview();
    res.status(200).json({ ok: true, ...overview });
  } catch (err) {
    const unavailable = err?.code === 'UNAVAILABLE';
    res.status(unavailable ? 503 : 500).json({
      error: unavailable ? 'UNAVAILABLE' : 'LOOKUP_FAILED',
      message: unavailable ? 'Admin directory is unavailable.' : 'Could not load admin directory.',
    });
  }
}
