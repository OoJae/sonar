// One-shot Telegram webhook registration. Run after setting TELEGRAM_BOT_TOKEN
// and TELEGRAM_WEBHOOK_SECRET in .env.local:
//   pnpm tsx scripts/telegram-setup.ts
import "./_env";
import { env } from "@/lib/utils/env";

const WEBHOOK_URL = "https://sonar.my.id/api/telegram/webhook";

async function tg(method: string, body?: Record<string, unknown>) {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not set in .env.local");
    process.exit(1);
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  const secret = env().TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set (openssl rand -hex 24)");
    process.exit(1);
  }

  const me = (await tg("getMe")) as { result?: { username?: string } };
  console.log("bot:", me.result?.username ?? "(unknown)");

  const set = await tg("setWebhook", {
    url: WEBHOOK_URL,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  console.log("setWebhook:", JSON.stringify(set));

  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Subscribe to Sonar cycle updates" },
      { command: "stop", description: "Unsubscribe" },
    ],
  });

  const info = (await tg("getWebhookInfo")) as { result?: unknown };
  console.log("webhookInfo:", JSON.stringify(info.result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
