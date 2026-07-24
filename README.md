# alecdivito-website-ghost-theme

Personal Ghost theme for [alecdivito.com](https://alecdivito.com) — a development and self-hosting blog. Built for Ghost 5+.

If you’re forking this: treat it as a working site theme, not a blank Ghost starter. Content depends on specific pages, tags, and theme settings described below.

## Install the theme

**Option A — zip (production / any Ghost host)**

```bash
npm install
npm run zip
```

Upload `alecdivito-website-ghost-theme.zip` in Ghost Admin → **Settings → Design → Change theme → Upload**.

**Option B — local symlink (development)**

```bash
nvm install          # uses this repo’s Node version if present
npm install -g ghost-cli@latest

GHOST_THEME_LOCATION=$(pwd)
cd ../ghost          # or wherever you keep the Ghost install
ghost install local
GHOST_LOCATION=$(pwd)

ln -s "$GHOST_THEME_LOCATION" "$GHOST_LOCATION/content/themes/alecdivito-website-ghost-theme"
ghost stop
ghost start --no-setup-linux-user
# Context: https://github.com/TryGhost/Ghost-CLI/issues/711
```

Then in Ghost Admin (`http://localhost:2368/ghost`):

1. **Settings → Design → Change theme → Installed**
2. Activate `alecdivito-website-ghost-theme`

If gallery / image cards look wrong locally, see [this Ghost forum thread](https://forum.ghost.org/t/error-ghost-gallery/5909/4).

## Content the theme expects

### Pages (create these in Ghost with matching slugs)

| Slug | Template | Purpose |
| --- | --- | --- |
| *(home)* | `home.hbs` | Homepage — hero, blog, projects, employers, tags |
| `blog` | `page-blog.hbs` | Full blog listing |
| `projects` | `page-projects.hbs` | Project posts |
| `tags` | `page-tags.hbs` | Tag index |
| `chat` | `page-chat.hbs` | Optional chat UI (needs agent URL) |
| `about` | `page.hbs` (or custom) | Linked from the “I Have Worked At” section |

### Tags

| Tag slug | Used for |
| --- | --- |
| `project` (or value of **Projects tag** setting) | Project cards on home + `/projects` |
| `worked-at` | Employer logo strip on the homepage |

Blog feed posts should **not** use the projects or `worked-at` tags — those are filtered out of the main feed and popular tags.

### Theme settings (Design → Theme)

| Setting | Notes |
| --- | --- |
| Hero title / intro / topics / supporting text / CTA | Homepage hero; topics are comma-separated and rotate |
| Show worked at | Toggle the employer logo strip |
| Projects tag | Tag slug for project posts on home + `/projects` |
| Show publication name | Show the site title in the header instead of the publication logo |
| Footer CTA | Signup blurb in the footer |
| GitHub / LinkedIn URL | Footer social links |
| Chat agent URL | Origin of `ghost-chat-agent` (e.g. `https://chat.alecdivito.com`). Empty disables chat and the Chat nav link |

### Homepage employers (“I Have Worked At”)

1. Create tag slug `worked-at`.
2. One post per employer; set the **feature image** to the logo (PNG or SVG).
3. The logo links to that post’s URL.
4. Keep **Show worked at** enabled.

No `worked-at` posts → section stays hidden. Those posts are excluded from the homepage blog feed and popular tags grid.

### Optional chat page

1. Create a **published** Ghost page with slug exactly `chat` (uses `page-chat.hbs`).
2. Set **Chat agent URL** to your agent origin.
3. Run the sibling backend [`ghost-chat-agent`](https://github.com/alecdivito/ghost-chat-agent) (or your local `../ghost-chat-agent`).

The theme sends `chat_id` + `session_id` on every `/v1/chat` request (and keeps the id from the SSE `done` event) so the agent can forward `X-Chat-Id` / `X-Session-Id` to [`llm-proxy`](https://github.com/alecdivito/llm-proxy).

### Translations (i18n)

UI chrome uses Ghost’s `{{t}}` helper. English strings live in [`locales/en.json`](locales/en.json). Copy to e.g. `locales/es.json`, translate, and set **Settings → General → Publication language**.

CMS content (posts, nav labels, theme-setting defaults) is edited in Ghost Admin, not via locale files. Chat JS status strings in `assets/js/chat` are still English-only.

## Development guide

Assets are built with [Rollup](https://rollupjs.org) + PostCSS. Source: `assets/js`, `assets/css` → output: `assets/built`.

### Setup

Symlink this repo into your Ghost `content/themes` folder (see **Install → Option B**), activate the theme, then from the theme root:

```bash
npm install
```

Requires a current Node (bestzip 3 needs Node ≥ 22).

### Start development mode

```bash
npm run dev
```

Rollup watches JS/CSS; livereload also picks up `.hbs` changes. Stop with `ctrl + c`.

### Build, zip, and test

```bash
npm run build   # production assets → assets/built
npm run zip     # theme zip for upload
npm run test    # gscan compatibility check (runs build first)
```

## License

MIT — see [LICENSE](LICENSE). Originally descended from Ghost’s starter theme; this repo is Alec Di Vito’s personal theme.
