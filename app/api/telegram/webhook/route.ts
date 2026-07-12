import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { env } from "@/lib/utils/env";
import { logger } from "@/lib/utils/logger";
import { sendMessage } from "@/lib/notify/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Telegram webhook. Validated by the secret token Telegram echoes back in the
// X-Telegram-Bot-Api-Secret-Token header on every delivery. Handles /start
// (subscribe) and /stop (unsubscribe) in private chats; ignores everything
// else. Always answers 200 fast so Telegram never queues retries; handlers are
// idempotent (upsert / flag-flip), so redeliveries are harmless.

function secretMatches(request: Request): boolean {
  const expected = env().TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false;
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
  };
};

const WELCOME =
  "You are subscribed to Sonar. You will get the daily cycle summary (thesis mode, allocations, fills, risk state) and new index proposals.\n\nDashboard: https://sonar.my.id\nSend /stop to unsubscribe.";
const GOODBYE = "Unsubscribed. Send /start any time to resume.";

export async function POST(request: Request) {
  if (!env().TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  }
  if (!secretMatches(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim() ?? "";
  if (!chatId || msg?.chat?.type !== "private") {
    return NextResponse.json({ ok: true });
  }

  try {
    if (text.startsWith("/start")) {
      await db()
        .insert(schema.telegramSubscribers)
        .values({ chatId, active: true })
        .onConflictDoUpdate({
          target: schema.telegramSubscribers.chatId,
          set: { active: true },
        });
      await sendMessage(chatId, WELCOME);
      logger.info("telegram.subscribed", { chatId });
    } else if (text.startsWith("/stop")) {
      await db()
        .update(schema.telegramSubscribers)
        .set({ active: false })
        .where(eq(schema.telegramSubscribers.chatId, chatId));
      await sendMessage(chatId, GOODBYE);
      logger.info("telegram.unsubscribed", { chatId });
    }
  } catch (err) {
    logger.warn("telegram.webhook_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return NextResponse.json({ ok: true });
}
