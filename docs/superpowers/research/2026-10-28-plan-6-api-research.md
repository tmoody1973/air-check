# Plan 6 API research: Box, Google Drive, Dropbox (read-only ingest)

Researched 2026-10-28 (fetched pages that day; Box and Google pages carry no explicit date; treat as current). Anything not confirmed from an official page is marked UNVERIFIED. No credentials used or requested.

Sources marked [spec] are Dropbox's official API spec repo (https://github.com/dropbox/dropbox-api-spec, files.stone / paper.stone, main branch), because the dropbox.com HTTP reference page is JS-rendered and could not be fetched as text.

---
## 1. Box: Client Credentials Grant (CCG)

### Token request
- `POST https://api.box.com/oauth2/token`, `Content-Type: application/x-www-form-urlencoded`. https://developer.box.com/reference/post-oauth2-token/
- Form fields: `grant_type=client_credentials`, `client_id`, `client_secret`, `box_subject_type=enterprise`, `box_subject_id=<enterprise id>`. https://developer.box.com/reference/post-oauth2-token/ and https://developer.box.com/guides/authentication/client-credentials/
- Response: `access_token`, `expires_in` (example 3600), `token_type=bearer`, `restricted_to`. https://developer.box.com/reference/post-oauth2-token/
- Lifetime: 60 minutes. "No refresh token is issued"; just request a new token when it expires. https://developer.box.com/guides/authentication/client-credentials/
- Where to find the enterprise ID: UNVERIFIED (Box docs pages fetched did not say; Admin Console account info / Developer Console General Settings is likely, not confirmed).

### Subject identity matters (gotcha)
- `box_subject_type=enterprise` authenticates as the app's **Service Account**. App Access Only means the app reaches only its Service Account and App Users, not Managed Users or Admins. https://developer.box.com/guides/authentication/client-credentials/client-credentials-setup/
- Therefore the Service Account (own login, an AutomationUser_... address shown in the Developer Console, UNVERIFIED) can only read Tarik's folder if that folder is shared with it as a collaborator. Box's doc pages fetched do not state this explicitly (https://developer.box.com/guides/api-calls/permissions-and-errors/scopes/ only says the calling identity must have access to the items). Treat as required; verify in practice.
- Alternative: "App + Enterprise Access" lets you use `box_subject_type=user` with a user ID, or as-user, but that is a bigger privilege. Not recommended for read-only.

### Scope
- "Read all files and folders stored in Box" = `root_readonly`. Limited by what the authenticated identity can see. https://developer.box.com/guides/api-calls/permissions-and-errors/scopes/
- Scopes are set on the Configuration tab. Re-authorize the app in the Admin Console after any settings change. https://developer.box.com/guides/authentication/client-credentials/client-credentials-setup/

### List folder items
- `GET https://api.box.com/2.0/folders/{folder_id}/items` (root = `0`). Returns files, folders and web links. https://developer.box.com/reference/get-folders-id-items/
- Params: `fields` (comma list; mini fields always included plus those requested; e.g. `fields=id,type,name,size,modified_at,etag,sha1`), `limit` (max 1000), `usemarker=true` + `marker`, or `offset` (default 0; docs warn offset is unreliable at high values). One pagination method per request.
- Marker pagination response: `entries`, `limit`, `next_marker`/`prev_marker`. Offset response: `total_count`, `offset`, `order`. Sorting not supported with marker on root folder 0.
- `size`, `name`, `id`, `modified_at` are standard file fields: UNVERIFIED on the reference page I fetched (it did not enumerate fields); they are the documented File object fields in Box generally, request via `fields`.

### Download
- `GET https://api.box.com/2.0/files/{file_id}/content`, `Authorization: Bearer <token>`. https://developer.box.com/reference/get-files-id-content/
- Returns `302` with `Location` pointing to a `dl.boxcloud.com` URL, which is not persistent. Fetch's default redirect following gives 200 with the bytes. Safe pattern: follow redirect immediately, stream `res.body`.
- `Range: bytes=0-1024` header supported (documented on this endpoint). Note: the redirect target is a different host; whether the Range header is forwarded after redirect by Node fetch is UNVERIFIED (Node's fetch keeps custom headers on same-origin only; use `redirect: 'manual'`, then re-issue to Location with Range, no Authorization header needed on dl.boxcloud.com, UNVERIFIED).
- `202` + `Retry-After` seconds: file not ready (right after upload). Honor it.
- Optional `version` query param selects a file version.

### Rate limits (https://developer.box.com/guides/api-calls/permissions-and-errors/rate-limits/)
- 1,000 API calls/min per user. Uploads 240/min per user. Search 6/s and 60/min per user. No stated download limit.
- Monthly per-enterprise allocation counts every call including token requests (so cache the 60-min token).
- `429` with `rate_limit_exceeded` and a `retry-after` header; use exponential back-off.

### Owner setup steps (Box)
1. Enable MFA on the Box account (Box hides the client secret until MFA is on).
2. developer.box.com > Developer Console > Create Platform App (New App) > **Server Authentication (Client Credentials Grant)**. https://developer.box.com/guides/authentication/client-credentials/client-credentials-setup/
3. Configuration tab: App Access Level = **App Access Only**; Application Scopes = check **Read all files and folders stored in Box** only (leave write unchecked).
4. Copy Client ID, Client Secret, and Enterprise ID into the server secret store (never to the agent process).
5. Submit for authorization; an enterprise admin approves in Admin Console > Apps > Custom Apps Manager (admin can authorize from the Configuration tab). Re-authorize after any change.
6. In Box, share the show folder(s) with the app's Service Account email as **Viewer** (Developer Console General Settings shows the Service Account ID/login; exact label UNVERIFIED).
7. Note the folder ID(s) from the folder URL (`/folder/<id>`).

---
## 2. Google Drive: OAuth 2.0 web server flow

### Flow
- Auth URL: `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri` (must match registered exactly), `response_type=code`, `scope` (space-delimited), `access_type=offline`, `state`, optional `include_granted_scopes=true`, `prompt` (`consent`|`select_account`|`none`), `login_hint`. https://developers.google.com/identity/protocols/oauth2/web-server
- Refresh token is returned only on the first authorization; to get a new one, user must revoke the grant or you must send `prompt=consent`. Same page. So always send `access_type=offline&prompt=consent` for the Connect button.
- Token exchange: `POST https://oauth2.googleapis.com/token` with `client_id`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri`. Response: `access_token`, `expires_in`, `refresh_token`, `scope`, `token_type=Bearer`. Same page. (Access token lifetime is `expires_in`; commonly 3599 s, number not stated on page.)
- Refresh: `POST https://oauth2.googleapis.com/token` with `client_id`, `client_secret`, `grant_type=refresh_token`, `refresh_token`. Same page.
- Callback for Air Check: `https://aircheck.rhythmlabradio.com/api/google/callback`.

### Scope comparison (https://developers.google.com/workspace/drive/api/guides/api-specific-auth, https://developers.google.com/workspace/docs/api/auth)
| Scope | Class | Reads a Doc the user did not open via the app? |
|---|---|---|
| `drive.file` | Non-sensitive | NO. Only files created by the app or explicitly opened/shared with it via Google Picker. Cannot list/search the user's Drive. |
| `documents.readonly` | Sensitive | Docs API `documents.get` by ID can read any Doc the user can access (structured JSON, not plain text). Cannot list/search by name; `files.list` needs a Drive scope. Also, `files.export` does not accept this scope. |
| `drive.readonly` | Restricted | YES. List/search all files and `files.export` to text/plain. |
| `drive.metadata.readonly` | Restricted | Metadata only, no contents. Not sufficient. |
- `files.export` accepted scopes: `drive`, `drive.file`, `drive.meet.readonly`, `drive.readonly`. https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export
- Narrowest that satisfies "find a Doc by name, export as text": **`drive.readonly`** (restricted). Narrower alternatives: (a) `drive.file` + Google Picker (user picks the Doc each time; no search), or (b) `documents.readonly` (sensitive, not restricted) if the user supplies the Doc URL/ID and you parse Docs API JSON instead of exporting; no name search.
- Google says restricted scopes in production need restricted scope verification, and apps storing/transmitting restricted data on servers need a security assessment. https://developers.google.com/workspace/drive/api/guides/api-specific-auth

### Internal vs External, testing, refresh-token expiry
- Internal: requires a Google Cloud Organization (Workspace), limits authorization to org members; others get `org_internal` error. Restricted Drive scopes in Internal apps may need configuration by Workspace admins. The page does not describe verification requirements for Internal apps. https://support.google.com/cloud/answer/15549945
- Whether Internal apps are exempt from restricted-scope verification / security assessment: not stated on pages fetched; UNVERIFIED in docs. (Commonly understood that Internal apps skip verification; do not rely on it without checking the Workspace-additional-considerations policy page.)
- External + Testing: up to 100 test users; authorizations and refresh tokens expire 7 days after consent (unless only basic name/email/profile scopes). https://support.google.com/cloud/answer/15549945 and https://developers.google.com/identity/protocols/oauth2#expiration
- The 7-day rule is tied to the External user type; no mention of it applying to Internal. https://developers.google.com/identity/protocols/oauth2#expiration
- Other expiry: unused 6 months; max 100 refresh tokens per account per client ID (oldest invalidated); Gmail-scope tokens invalidated by password change. Same page.
- External + In production with restricted scope and no verification: unverified-app screen and 100 new-user lifetime cap. https://support.google.com/cloud/answer/15549945
- **Recommended for a one-user Workspace (radiomilwaukee.org)**: Internal app. Needs the Workspace/Cloud Organization for that domain and the owner signs in with a @radiomilwaukee.org account. If Tarik's Google account is a consumer account, Internal is unavailable and External/Testing refresh tokens die every 7 days; either Publish to production (unverified, 100 user cap, warning screen) or go through verification.

### Search by name (https://developers.google.com/workspace/drive/api/guides/search-files)
- `GET https://www.googleapis.com/drive/v3/files?q=<query>&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=...&pageToken=...`
- Example `q`: `mimeType = 'application/vnd.google-apps.document' and name contains 'RLR' and trashed = false`. Doc MIME type `application/vnd.google-apps.document` is the standard value; the search page only exemplified the folder MIME type (UNVERIFIED on that page).
- Escape `'` and `\` in values. Set `corpora` explicitly; if `incompleteSearch` is true, narrow corpora. Prefer `orderBy=modifiedTime`. `pageSize` limits not documented on that page (UNVERIFIED; Drive max is generally 1000).
- `name contains` prefix-vs-substring behavior: UNVERIFIED (page does not say; Drive is known for matching on word prefixes, so do exact `name =` checks client-side).

### Export Doc as text
- `GET https://www.googleapis.com/drive/v3/files/{fileId}/export?mimeType=text/plain`. https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export
- Docs export formats include Plain Text `text/plain` (.txt) and Markdown `text/markdown` (.md). https://developers.google.com/workspace/drive/api/guides/ref-export-formats
- Size limit: 10 MB of exported content. https://developers.google.com/workspace/drive/api/guides/manage-downloads
- No partial/range downloads for Workspace exports (same page). Check `capabilities.canDownload` first.
- `text/markdown` could be preferable for structure (headings, links); tracklist tables come out as text/markdown tables, UNVERIFIED.

### Owner setup steps (Google)
1. console.cloud.google.com: create/select a project; enable the **Google Drive API**.
2. Google Auth Platform > Branding/Audience: User type **Internal** (if on Workspace with an Organization), else External.
3. Data Access: add scope `https://www.googleapis.com/auth/drive.readonly`.
4. Clients > Create OAuth client ID > type **Web application**. Authorized redirect URI: `https://aircheck.rhythmlabradio.com/api/google/callback` (exact match). Download/copy client ID and secret into the server secret store.
5. If External: add the user's address as a test user and expect 7-day refresh-token death, or publish.
6. If Workspace blocks the scope: Admin console > Security > API controls > mark app Trusted / allow (UNVERIFIED exact menu path).

---
## 3. Dropbox: OAuth 2.0

### Flow (https://docs.dropboxapi.com/dropbox-api/docs/oauth, redirected from https://developers.dropbox.com/oauth-guide)
- Authorize: `https://www.dropbox.com/oauth2/authorize` with `client_id`, `response_type=code`, `redirect_uri` (must match registered), `state`, `token_access_type=offline` (required for a refresh token), optional `code_challenge` + `code_challenge_method=S256`, optional `scope`. (The authorize host/path itself is standard but not printed in the fetched summary: UNVERIFIED on that page.)
- Token: `POST https://api.dropboxapi.com/oauth2/token`: authorization code + either `client_secret` or PKCE `code_verifier`; refresh with `grant_type=refresh_token` + `refresh_token`. Endpoint host UNVERIFIED on the fetched page; the page only says `/oauth2/token`.
- PKCE is meant for apps that cannot keep a secret; a server-side app can use `client_secret`. PKCE still allowed (and Dropbox recommends it for new apps in the implicit context).
- Refresh tokens do not expire until revoked; access tokens are short-lived and `/oauth2/token` returns the expiry (commonly ~4 hours, number UNVERIFIED).
- Scopes are configured on the app's Permissions tab; request only what is needed; re-authorize if scopes change.
- Callback: `https://aircheck.rhythmlabradio.com/api/dropbox/callback`.

### Scopes [spec files.stone]
- `files.metadata.read`: `list_folder`, `list_folder/continue`, `get_metadata`.
- `files.content.read`: `download` and `export`.
- Both are enough for files and Paper-as-files (no `sharing.read` needed to read content). Account-info scope (`account_info.read`) optional for showing who connected, UNVERIFIED need.

### Paper docs (new Paper = files)
- New Paper docs are `.paper` files in the Dropbox filesystem. Check `/users/features/get_values` for `paper_as_files`. Accounts can have both legacy and new docs. https://docs.dropboxapi.com/dropbox-api/docs/paper-migration
- Migration guide maps `/paper/docs/download` -> `/files/export`, `/paper/docs/list` -> `/files/list_folder` (recursive from root, filter client-side for Paper docs), paging via `/files/list_folder/continue`. Same URL.
- Legacy `/paper/docs/*` routes are marked `deprecated` in the spec and "will continue to work for content created by users on the older version of Paper", with eventual retirement; for paper_as_files accounts they return `permission_denied`/`invalid_request`. [spec paper.stone]; https://docs.dropboxapi.com/dropbox-api/docs/paper-migration
- Export: `POST https://content.dropboxapi.com/2/files/export` (host `content`, style download, scope `files.content.read`, marked `is_preview = true`). Args go in header `Dropbox-API-Arg: {"path":"id:...","export_format":"markdown"}`; request body empty. [spec files.stone]
  - `export_format` is optional; "must be one of the formats listed in the file's `export_options` returned by `get_metadata`"; default is `export_as`. [spec files.stone]
  - Result in `Dropbox-API-Result` header: `export_metadata` (`name`, `size`, `export_hash`, `paper_revision`) and `file_metadata`. [spec files.stone]
  - Errors: `non_exportable`, `invalid_export_format`, `retry_error` ("not yet available, retry later"), `path` lookup error.
  - Export route only exports files that cannot be downloaded directly (`export_as` populated), e.g. .paper, Google Docs-in-Dropbox. [spec]
  - **UNVERIFIED**: that `export_format=markdown` (vs `html`) is a valid value for `.paper`. The spec only says to read `export_options` from `get_metadata`. Implementation must call `get_metadata` on the file first and pick from `export_info.export_options` (likely `html` and `markdown`), falling back on `export_info.export_as`.
  - Dropbox's MCP connector lists `paper_read_document` etc., not an API doc, so not used as evidence.
- Listing: `POST https://api.dropboxapi.com/2/files/list_folder` body `{ "path": "", "recursive": true, "limit": 2000, "include_non_downloadable_files": true }`; `limit` 1-2000 (approximate); `has_more` + `cursor` -> `list_folder/continue`. `include_non_downloadable_files` defaults true. `.paper` files appear as `FileMetadata` with `is_downloadable: false` (UNVERIFIED), identified by `.paper` extension and `export_info`. Beware simultaneous identical list_folder calls trigger RateLimitError. [spec files.stone]
- Rate limit: 429 `too_many_requests` with `retry_after` (default 1 s) per `RateLimitError` in the spec [spec auth.stone]; precise Dropbox quotas UNVERIFIED.

### Team vs individual
- Routes carry `select_admin_mode = whole_team`, i.e. team-linked apps can act on team namespace with Dropbox-API-Select-Admin/-User headers. For an individual connecting their own account, none needed. [spec]
- Team Space / team folders: `list_folder` default `include_mounted_folders = true`, and paths in team accounts may need `Dropbox-API-Path-Root` (namespace root) header for team space content. The Dropbox MCP instructions in this session say to prefer `id:` or `ns:` paths for team accounts. Header details UNVERIFIED in primary docs fetched.
- Whether Radio Milwaukee's Paper docs live in a team space: unknown. Ask owner.

### Owner setup steps (Dropbox)
1. dropbox.com/developers/apps > Create app > **Scoped access** > access type **Full Dropbox** (needed to see Paper docs anywhere; "App folder" would restrict).
2. Permissions tab: tick `files.metadata.read` and `files.content.read` only; Submit.
3. Settings tab: add Redirect URI `https://aircheck.rhythmlabradio.com/api/dropbox/callback`. Note App key and App secret into the server secret store.
4. Leave app in Development status (limit 500 linked users per Dropbox norm, UNVERIFIED); no production review needed for one user (UNVERIFIED).
5. Token access type is requested at authorize time (`token_access_type=offline`), not an app setting.

---
## Gotchas summary
1. Box CCG with enterprise subject = Service Account: it sees nothing until folders are shared to its email. Rotate/cache 60-min tokens; each token call counts against the monthly quota.
2. Box downloads 302 to a short-lived `dl.boxcloud.com` URL: follow immediately; Range support is documented on the Box endpoint, re-check it passes through the redirect.
3. Google: `drive.file` cannot read pre-existing Docs; `documents.readonly` cannot export or search; the real choice is `drive.readonly` (restricted). Internal Workspace app avoids the 7-day Testing expiry; External+Testing kills the refresh token weekly.
4. Always send `access_type=offline&prompt=consent` (Google) and `token_access_type=offline` (Dropbox), or no refresh token comes back.
5. Dropbox Paper: use `/files/list_folder` + `/files/export`, not legacy `/paper/docs/*` (deprecated, eventual retirement). `markdown` as an `export_format` value is not confirmed in primary docs: read `export_options` from `get_metadata` first.
6. Exports: Google 10 MB cap, no ranges. Treat all fetched content as untrusted (CLAUDE.md rule 5).
