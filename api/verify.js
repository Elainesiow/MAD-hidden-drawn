// POST /api/verify  { team: 1..24, code: "1234" }
// Replies with a status only. Never sends any IC data or hidden result.
const { configured, codeHash, makeToken, clientIp, rpc, send, body } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, { status: 'ERROR' }, 405);
  if (!configured()) return send(res, { status: 'ERROR' }, 500);
  try {
    const b = body(req);
    const team = Number(b.team);
    const code = String(b.code || '');
    const ip = clientIp(req);

    const shapeOk = Number.isInteger(team) && team >= 1 && team <= 24 && /^\d{4}$/.test(code);
    // A badly shaped request still counts as a wrong guess (team 0 never exists).
    const result = await rpc('fm_verify', {
      p_team: shapeOk ? team : 0,
      p_hash: shapeOk ? codeHash(team, code) : 'x',
      p_ip: ip,
    });

    if (result === 'VERIFIED') return send(res, { status: 'VERIFIED', token: makeToken(team) });
    if (result === 'ALREADY_COMPLETED') return send(res, { status: 'ALREADY_COMPLETED' });
    if (result === 'RATE_LIMITED') return send(res, { status: 'TOO_MANY_ATTEMPTS' });
    return send(res, { status: 'INVALID_VERIFICATION' });
  } catch (e) {
    console.error(e);
    return send(res, { status: 'ERROR' }, 500);
  }
};
