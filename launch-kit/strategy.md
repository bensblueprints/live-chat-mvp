# Launch Strategy — Chatlet

## Positioning

"Pay once. Own it forever. No subscription." Target: small e-commerce stores and bootstrapped SaaS who just want a chat bubble on their site — not a "customer engagement platform." They're currently on Tawk's branded free tier, Crisp's $95/mo team plan, or grimacing at Intercom's per-seat invoice.

## Target communities (rules-aware angles)

- **r/selfhosted** (self-promo Sunday / show-off threads allowed): "I replaced Crisp with a single Node process + SQLite — MIT source." Lead with architecture and the docker-compose, not the price. This crowd converts on data ownership.
- **r/ecommerce** (no bare self-promo; answer threads): watch for weekly "which live chat do you use?" threads — genuinely compare Tawk/Crisp/Chatlet, disclose you built it.
- **r/SaaS** / **r/indiehackers**: build-in-public angle — "the economics of replacing a $95/mo tool with a $49 one-time product." Share revenue + churn-free model discussion; the product is the case study.
- **r/webdev** (Showoff Saturday): the shadow-DOM widget + WS-with-polling-fallback implementation writeup; link repo.
- **r/Entrepreneur**: cost-cutting listicle angle — "5 SaaS bills a small store can delete this month" with Chatlet as one item; disclose affiliation.
- **Indie Hackers product thread + Tawk/Crisp alternative comparison pages** (SEO play below).

## Hacker News — Show HN draft

**Title:** Show HN: Chatlet – self-hosted live chat in one Node process (MIT)

**Post:**
Every website chat product converges on the same $39–95/month subscription, and your customer conversations live on the vendor's servers. The core product is genuinely small: an embeddable widget, a WebSocket hub, and a messages table.

Chatlet is that core, self-hosted: a shadow-DOM widget you embed with one script tag, a real-time agent dashboard (typing indicators, canned /shortcuts, visitor context: current page/referrer/history), offline "leave a message" with BYO-SMTP email notify, and multi-site support. WebSockets with an HTTP-polling fallback for networks that block WS. Everything is Express + better-sqlite3 + ws; the dashboard is React. There's an Electron mode so agents can run the console as a desktop app all day, or you deploy it to any $5 VPS with the included Dockerfile.

MIT source. I sell a packaged 1-click installer for $49 one-time — that's the business model experiment: can "pay once" software fund itself against subscription incumbents? Happy to answer anything about the WS reconnect/queue design or the economics.

## SEO keywords (10)

1. self-hosted live chat
2. crisp alternative
3. intercom alternative for small business
4. tawk.to alternative without branding
5. live chat widget open source
6. website chat widget self hosted
7. one-time payment live chat software
8. live chat no subscription
9. add live chat to website free
10. livechat pricing alternative

## AppSumo / PitchGround pitch

Chatlet gives every store and SaaS the live-chat bubble they're currently renting for $39–95/month — as a product they own. One-line embed, real-time agent dashboard with visitor context and canned responses, offline messages with email notify, unlimited sites/agents/conversations, and both desktop-app and Docker deployment out of the box. It's MIT-licensed Node + SQLite, so there's zero platform risk for buyers: even if we vanish, their chat keeps running. Chat is the highest-recognition SaaS category on your marketplace — every buyer already pays a competitor monthly, which makes the lifetime-deal math instant: your customers break even against Crisp's team plan in 19 days.

## Price

**$49 one-time** (installer + updates via Whop; source is MIT).

Competitor math:
- Crisp Plus (team features): $95/mo → Chatlet pays for itself in **16 days** (~0.5 months).
- Intercom: ~$39/seat/mo → one seat covers Chatlet in **1.3 months**; a 3-agent team saves ~$1,400/yr.
- Tawk.to "free": $228/yr just to remove their branding → Chatlet is cheaper than *the free tool's* branding fee within 3 months.
