# 027: Release cards take their cover and their own links from the email

**Decision.** When a co-sign email (for example a Mailchimp roundup) carries a cover picture and links for each release, each release card shows its own cover and only its own links. The model never sees or writes an address: it answers with numbered markers (`[image 2]`, `[link 3]`), and code turns the numbers into addresses.

**Why this came up.** On Oct 30 Tarik asked: "It would be great to get the links and album artwork in emails if available." Until now the email cleaner turned every link into a bare `[link]` and dropped every picture. A roundup's releases each received every link in the email, and a card had a cover only when a Bandcamp page supplied one. If we got this wrong in one direction, a model could be steered into writing an address (Hard Rule 5); in the other, a card could show another release's cover.

**Options.**
1. Numbered markers (chosen). When an email is stored, code keeps each allowed cover's address in a list and leaves `[image N]` where the picture was, and numbers links `[link N]` to match the stored link list. The model answers `"image": N, "links": [N, …]`. Code keeps only numbers that really appear as markers, and Convex looks them up in the stored lists. Cost: more cleaning code, and the model has to judge which picture sits with which release.
2. Hand the model the image addresses. Simpler, but the model would read and write URLs from untrusted email, which Hard Rule 5 rules out.
3. Give every release in an email the email's first picture. No model judgment, but in a roundup most covers would be wrong.

**What we chose and why.** Option 1, at Tarik's request. Covers are kept only from three image hosts: `mcusercontent.com` and `gallery.mailchimp.com` (where Mailchimp stores newsletter pictures, used by co-sign) and `*.bcbits.com` (Bandcamp's). Only https addresses are kept: no login details, no port, and no query (these hosts serve the picture without one, and a query can carry tracking). Pictures 3 pixels wide or smaller, and files named like spacers or open-trackers, are dropped as tracking pixels. Only co-sign email is read this way, and only when its HTML holds an allowed cover; every other email is stored exactly as before. When the release later gets a Bandcamp page, that page's cover replaces the email's. A release the model gives no link numbers still takes every link in the email, as before.

**What we gave up.** Tarik's browser now loads Mailchimp-hosted pictures when he opens the radar, so Mailchimp's image servers can log that a page view happened (the time and his IP address). No referrer is sent, and no Air Check server ever fetches the pictures. The model can still pair a cover with the wrong release when a newsletter's layout is unclear. The pairing is checked only for "is this a real marker", not "is this the right one". A roundup forwarded as plain text only, with no HTML, gets no covers.

**How we'll know if this was right.** In the next three co-sign roundups Tarik forwards, every card that shows a cover shows the right one, and each card's links lead to that release, not another.

**What actually happened.**
