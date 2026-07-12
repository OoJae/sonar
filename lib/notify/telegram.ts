// Telegram notification layer. The dashboard is the terminal; this is the pager.
//
// Broadcasts go to the public channel (TELEGRAM_CHANNEL_ID) and to every active
// /start subscriber. HTML parse mode (only &, <, > need escaping; MarkdownV2
// requires escaping 18 characters including "." and "-", hostile to financial
// text). No-ops entirely when TELEGRAM_BOT_TOKEN is unset. Never throws to
// callers: a lost notification must never break an agent cycle.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";

const SEND_GAP_MS = 50; // Telegram bulk guidance is ~30 msg/s; stay far under.

export function telegramEnabled(): boolean {
  return Boolean(env().TELEGRAM_BOT_TOKEN);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type SendResult =
  | { ok: true }
  | { ok: false; status: number; description: string };

// Send one HTML message. Retries once on 429 honoring retry_after.
export async function sendMessage(
  chatId: number | string,
  html: string,
  retried = false,
): Promise<SendResult> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, status: 0, description: "disabled" };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as {
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (res.status === 429 && !retried) {
      const wait = (body.parameters?.retry_after ?? 3) * 1000 + 250;
      await sleep(wait);
      return sendMessage(chatId, html, true);
    }
    return {
      ok: false,
      status: res.status,
      description: body.description ?? `http_${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      description: err instanceof Error ? err.message : String(err),
    };
  }
}

// A 403 (blocked/deactivated) or "chat not found" means the subscriber is gone.
function isGoneForever(r: SendResult): boolean {
  if (r.ok) return false;
  return (
    r.status === 403 || /chat not found/i.test(r.description)
  );
}

// Broadcast to the channel plus all active subscribers. Never throws.
export async function broadcast(html: string): Promise<void> {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN) return;

  if (e.TELEGRAM_CHANNEL_ID) {
    const r = await sendMessage(e.TELEGRAM_CHANNEL_ID, html);
    if (!r.ok) {
      logger.warn("telegram.channel_post_failed", {
        status: r.status,
        description: r.description.slice(0, 120),
      });
    }
  }

  let subscribers: Array<{ chatId: number }> = [];
  try {
    subscribers = await db()
      .select({ chatId: schema.telegramSubscribers.chatId })
      .from(schema.telegramSubscribers)
      .where(eq(schema.telegramSubscribers.active, true));
  } catch (err) {
    logger.warn("telegram.subscriber_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const s of subscribers) {
    const r = await sendMessage(s.chatId, html);
    if (isGoneForever(r)) {
      await db()
        .update(schema.telegramSubscribers)
        .set({ active: false })
        .where(eq(schema.telegramSubscribers.chatId, s.chatId))
        .catch(() => undefined);
    }
    await sleep(SEND_GAP_MS);
  }
}
