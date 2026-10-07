// POST /api/move  { token }
// Records the team's one-time First Move. The hidden result is decided and stored
// inside the database and is never sent back to the browser.
const { configured, readToken, rpc, send, body } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, { status: 'ERROR' }, 405);
  if (!configured()) return send(res, { status: 'ERROR' }, 500);
  try {
    const team = readToken(body(req).token);
    if (!team) return send(res, { status: 'INVALID_VERIFICATION' });

    const result = await rpc('fm_make_move', { p_team: team });
    if (result === 'SUCCESS') return send(res, { status: 'SUCCESS' });
    if (result === 'ALREADY_COMPLETED') return send(res, { status: 'ALREADY_COMPLETED' });
    return send(res, { status: 'ERROR' }, 500);
  } catch (e) {
    console.error(e);
    return send(res, { status: 'ERROR' }, 500);
  }
};
