# MAD VENTURE 2026 — First Move

A small standalone site for the 24 Team Leaders. Separate from Teamspace.

- `index.html` — the participant experience
- `admin.html` — organiser page (open at `/admin`)
- `api/` — server code (verification, one-time move, admin)
- `supabase.sql` — database setup (run once)

## Launch (about 15 minutes)

**1. Database**
Supabase → open a project (a new one, or any existing one: this only adds tables starting with `fm_`) → SQL Editor → paste everything from `supabase.sql` → Run.

**2. GitHub**
Create a new private repo (e.g. `mad-first-move`) → "uploading an existing file" → drag in everything from this folder → Commit.

**3. Vercel**
Add New → Project → import the repo → Framework Preset: **Other** → open Environment Variables and add these 3:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → `service_role` key (or a "secret" key). Never the anon/publishable key. |
| `ADMIN_PASSWORD` | A long password you choose (8+ characters) |

Click Deploy.

**4. Load the data**
Open `https://YOUR-SITE.vercel.app/admin` → enter the admin password →
- paste the 24 IC last-4 digits (one per line, like `01 1234`) → Save
- paste the hidden result pool (one line per slot) → Save

**5. Test, then send**
Do one full run as a team on your phone. In the admin page press **Reset** on that team. Send the main URL to the Team Leaders.

## Good to know

- The IC digits are scrambled using the server key before they are saved. If you ever change `SUPABASE_SERVICE_ROLE_KEY`, re-enter the IC digits in the admin page.
- Changing an environment variable in Vercel needs a Redeploy to take effect.
- 5 wrong IC tries locks that team for 15 minutes (then 30, 60 ...). Use **Unlock** in the admin page if a real leader gets locked.
- If the pool is empty when a team moves, the move is still locked in and a random 6-digit seed + timestamp is saved. Add the pool later and press "Give results to teams that are still blank".
- To change the allocation rule itself, only the function `fm_make_move` in `supabase.sql` needs to change. The participant pages never see the result.
- Wording of the story is at the top of the script in `index.html` (`STORY`).
