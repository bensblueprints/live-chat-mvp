# Product Hunt Launch — Chatlet

## Name
Chatlet

## Tagline (60 chars)
Self-hosted live chat for your site. Pay once, own forever.

## Description (260 chars)
Chatlet is the chat bubble you'd pay Crisp or Intercom $95+/mo for — self-hosted. One-line embed, real-time agent dashboard, canned responses, offline messages with email notify, unlimited sites & agents. SQLite + Node, MIT source, $49 once. Your data stays yours.

## Full description

Every small e-commerce store and SaaS eventually wants the same thing: a little chat bubble so visitors can ask "does this ship to Canada?" before they bounce. The going rate for that bubble is $39–95/month, per seat, forever — plus your customer conversations live on someone else's servers.

Chatlet is that bubble, minus the subscription:

🔹 **One-line embed** — shadow-DOM widget that can't clash with your site's CSS
🔹 **Real-time** — WebSockets with auto-reconnect and an HTTP-polling fallback for strict firewalls
🔹 **Agent dashboard** — live inbox, unread badges, typing indicators, sound + browser notifications
🔹 **Visitor context** — see their current page, referrer, browser, and past conversations while you type
🔹 **Canned responses** — `/shortcut` and it's sent
🔹 **Offline mode** — "leave a message" → stored in your inbox + optional email via your own SMTP
🔹 **Unlimited everything** — sites, agents, conversations. It's your server.
🔹 **Run it your way** — desktop app for the agent console, Docker for a $5 VPS

MIT-licensed source. $49 one-time for the packaged installer. Crisp's team plan costs that every 2.5 weeks.

## Maker first comment

Hey PH 👋

I run a couple of small e-com stores, and every one of them needed live chat. I tried the free tiers: Tawk wants $228/yr just to remove their branding, Crisp's useful features start at $95/mo, and Intercom… let's not talk about Intercom pricing.

The actual product under all of that is: a widget, a WebSocket, and a table of messages. So I built Chatlet — the whole thing runs off one Node process and one SQLite file. I've been running it as a desktop app all day (it ships with an Electron mode) with the widget on three of my sites, and honestly the visitor-context sidebar (what page they're on, where they came from) covers 90% of what I used the paid tools for.

It's MIT on GitHub if you want to self-host from source. The $49 is for the 1-click installer + updates, and that's the only money that will ever change hands. Ask me anything!

## Gallery shots (5)

1. **Hero** — split shot: website with the Chatlet bubble open (visitor side) next to the dark agent dashboard answering in real time. Caption: "Live chat without the monthly bill."
2. **Dashboard inbox** — conversation list with unread badges + live typing indicator, chat pane, visitor context sidebar visible. Caption: "See their page, referrer, and history while you reply."
3. **Canned responses** — composer with `/ref` typed and the autocomplete dropdown showing. Caption: "Type /shortcut. Sent."
4. **Offline mode** — widget showing "No one is online — leave a message" + the email notification it triggers. Caption: "Never lose the 2am lead."
5. **Comparison card** — Chatlet $49 once vs Crisp $1,140/yr vs Intercom per-seat. Caption: "Pays for itself in 19 days."
