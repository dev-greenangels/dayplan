# GA-DayPlan

Планування робочого дня для команд Green Angels. Закритий внутрішній застосунок на Next.js + Supabase.

## Getting Started

```bash
pnpm install
cp .env.example .env.local   # заповніть ключі
pnpm dev
```

Відкрийте [http://localhost:3000](http://localhost:3000).

Потрібні змінні середовища описані в `.env.example` (Supabase, Gmail SMTP, Web Push VAPID).

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4
- Supabase (Auth, Postgres, RLS)
- Email через Gmail SMTP, web push через VAPID
