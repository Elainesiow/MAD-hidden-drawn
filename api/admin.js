// POST /api/admin  { password, action, ... }   — organiser only.
const { ADMIN_PASSWORD, configured, safeEqual, codeHash, clientIp, rpc, send, body } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, { ok: false, error: 'Method not allowed' }, 405);
  if (!configured() || ADMIN_PASSWORD.length < 8) {
    return send(res, { ok: false, error: 'Server is not set up yet (check the 3 environment variables; admin password needs 8+ characters).' }, 500);
  }
  try {
    const b = body(req);
    const ip = clientIp(req);

    if (await rpc('fm_ip_blocked', { p_ip: ip })) {
      return send(res, { ok: false, error: 'Too many wrong attempts. Wait 15 minutes.' }, 429);
    }
    if (!safeEqual(b.password || '', ADMIN_PASSWORD)) {
      await rpc('fm_ip_fail', { p_ip: ip });
      return send(res, { ok: false, error: 'Wrong password.' }, 401);
    }

    const team = Number(b.team);
    const teamOk = Number.isInteger(team) && team >= 1 && team <= 24;
    let message = '';

    switch (b.action) {
      case 'list':
        break;

      case 'set_codes': {
        // One team per line, e.g. "01 1234" or "MAD 01, 1234". Digits are scrambled before storing.
        const rows = [];
        const bad = [];
        String(b.text || '').split(/\r?\n/).forEach((line) => {
          if (!line.trim()) return;
          const nums = line.match(/\d+/g) || [];
          const t = Number(nums[0]);
          const code = nums[nums.length - 1];
          if (nums.length >= 2 && t >= 1 && t <= 24 && /^\d{4}$/.test(code)) {
            rows.push({ team: t, hash: codeHash(t, code) });
          } else {
            bad.push(line.trim());
          }
        });
        const n = rows.length ? await rpc('fm_admin_set_codes', { p_codes: rows }) : 0;
        message = `Saved IC digits for ${n} team(s).` + (bad.length ? ` Could not read ${bad.length} line(s): ${bad.join(' | ')}` : '');
        break;
      }

      case 'set_pool': {
        const list = String(b.text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const n = await rpc('fm_admin_set_pool', { p_results: list });
        message = `Pool updated. ${n} unused slot(s) waiting.`;
        break;
      }

      case 'fill_blanks': {
        const n = await rpc('fm_admin_fill_blanks', {});
        message = `Filled ${n} blank result(s).`;
        break;
      }

      case 'set_result':
        if (!teamOk) return send(res, { ok: false, error: 'Bad team.' }, 400);
        await rpc('fm_admin_set_result', { p_team: team, p_result: String(b.result || '') });
        message = `Result updated for MAD ${String(team).padStart(2, '0')}.`;
        break;

      case 'reset_team':
        if (!teamOk) return send(res, { ok: false, error: 'Bad team.' }, 400);
        await rpc('fm_admin_reset_team', { p_team: team });
        message = `MAD ${String(team).padStart(2, '0')} has been reset.`;
        break;

      case 'unlock':
        if (!teamOk) return send(res, { ok: false, error: 'Bad team.' }, 400);
        await rpc('fm_admin_unlock', { p_team: team });
        message = `MAD ${String(team).padStart(2, '0')} unlocked.`;
        break;

      default:
        return send(res, { ok: false, error: 'Unknown action.' }, 400);
    }

    const data = await rpc('fm_admin_list', {});
    return send(res, { ok: true, message, data });
  } catch (e) {
    console.error(e);
    return send(res, { ok: false, error: 'Server error. Check that the SQL script was run in Supabase.' }, 500);
  }
};
