# 010: Production sign-in lives on `aircheck.rhythmlabradio.com`, with email codes first

**Decision:** Clerk (the hosted sign-in service) runs its production instance on the subdomain `aircheck.rhythmlabradio.com`, not on the root `rhythmlabradio.com`. Sign-in uses emailed one-time codes at launch; "Sign in with Google" comes later.

**Why this came up:** Going live means Clerk needs a real domain it can set cookies on and prove it controls (by DNS records, the public address book that maps names to servers). The domain chosen decides which other sites share a login, and who can use the root domain for anything else. Changing it later means moving every user and re-issuing every session.

**Options:**
1. **Clerk on the root, `rhythmlabradio.com`.** Cost: a sign-in cookie (the small note a browser keeps to say "you are signed in") on the root would be sent to every station subdomain too, so sessions would be shared across sites that have nothing to do with Air Check. It would also tie the root to this one Clerk app, which matters to anyone else at the station who wants to use the root for another project.
2. **Clerk on the subdomain, `aircheck.rhythmlabradio.com`.** Cost: five extra DNS records at GoDaddy for Clerk to verify the domain and send mail, and the demo and the console must live on that exact name.
3. **Stay on Clerk's development instance.** Cost: it is not meant for real users, shows a "development" badge, and judges would see it.

For sign-in methods:
- **Email codes first.** Works with no extra setup. Cost: one more step for the user than a Google button.
- **Google now.** Cost: needs a Google OAuth client (the registration that lets Google trust our sign-in page) created under Tarik's own Google account, which was not ready.

**What we chose and why:** Option 2, with email codes first (Tarik chose, on Claude's recommendation). The subdomain keeps the blast radius to Air Check alone and leaves the root free. Google is deferred, not dropped: it needs only the OAuth client and a Clerk setting, no code change.

**What we gave up:** A one-click Google sign-in at launch, and a few minutes of one-off DNS work. Anyone who signs in must wait for an emailed code.

**How we'll know if this was right:** A radiomilwaukee.org staff member can sign in with an emailed code on the live site, the demo user cannot reach staff-only pages, and nothing else on `rhythmlabradio.com` is affected by Air Check's cookies. If staff ask for Google sign-in, add it.

**What actually happened:**
