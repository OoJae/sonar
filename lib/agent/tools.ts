import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  getCurrencyList,
  getNewsFeatured,
  getEtfSummaryHistory,
  getEtfList,
} from "@/lib/sosovalue/client";
import { SosoEndpoint } from "@/lib/sosovalue/types";
import { readAllIndexSnapshots, readIndexSnapshot } from "@/lib/ssi/reader";
import { SSI_INDEX_KEYS, type SsiIndexKey } from "@/lib/ssi/addresses";
import {
  EtfAssetSchema,
  ThesisPayloadSchema,
  ThesisSchema,
  type Thesis,
} from "./thesis";
import { logger } from "@/lib/utils/logger";

type ThesisCapture = { thesis: Thesis | null };

export function buildAgentTools(capture: ThesisCapture) {
  return {
    listCurrencies: tool({
      description:
        "List SoSoValue's master currency table. Useful for confirming asset symbols before referencing them in signals.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        const res = await getCurrencyList();
        const items = res.data.data ?? [];
        return {
          count: items.length,
          sample: items.slice(0, 8),
          staleAt: res.staleAt.toISOString(),
          source: res.source,
        };
      },
    }),

    getHistoricalFlows: tool({
      description:
        "Get the last ~30 days of ETF net inflow series for a single asset (US market). Use one call per asset you plan to cite.",
      inputSchema: z.object({ asset: EtfAssetSchema }),
      execute: async ({ asset }) => {
        const res = await getEtfSummaryHistory(asset);
        // API returns reverse-chronological; flip for human-friendly weekly math.
        const series = [...(res.data.data ?? [])].reverse();
        const latest = series[series.length - 1];
        const weekly = series.slice(-7);
        const weeklyNet = weekly.reduce(
          (acc, p) => acc + (p.total_net_inflow ?? 0),
          0,
        );
        return {
          asset,
          latestDate: latest?.date ?? null,
          latestNetInflow: latest?.total_net_inflow ?? null,
          last7DayNetInflow: weeklyNet,
          points: series.length,
          source: res.source,
          staleAt: res.staleAt.toISOString(),
          sourceEndpoint: SosoEndpoint.EtfSummaryHistory,
        };
      },
    }),

    getEtfList: tool({
      description:
        "List the spot ETFs available for a given asset symbol on a given country market (default US). Returns ticker, name, exchange.",
      inputSchema: z.object({
        asset: EtfAssetSchema,
        countryCode: z.string().length(2).default("US"),
      }),
      execute: async ({ asset, countryCode }) => {
        const res = await getEtfList(asset, { countryCode });
        return {
          asset,
          countryCode,
          funds: res.data.data ?? [],
          source: res.source,
          staleAt: res.staleAt.toISOString(),
          sourceEndpoint: SosoEndpoint.EtfList,
        };
      },
    }),

    getFeaturedNews: tool({
      description:
        "Global featured news feed. Returns up to 30 recent items. Sentiment is not provided by the API; infer stance from headline + content yourself.",
      inputSchema: z.object({ pageSize: z.number().int().min(20).max(100).default(30) }),
      execute: async ({ pageSize }) => {
        const res = await getNewsFeatured({ pageSize });
        const items = (res.data.data.list ?? []).slice(0, pageSize);
        return {
          total: res.data.data.total ?? items.length,
          items: items.map((it) => ({
            id: it.id,
            title: it.multilanguageContent?.find((m) => m.language === "en")?.title
              ?? it.multilanguageContent?.[0]?.title
              ?? null,
            sourceLink: it.sourceLink,
            releaseTime: it.releaseTime,
            category: it.category,
            tags: it.tags,
            matchedCurrencies: it.matchedCurrencies?.map((c) => c.name),
          })),
          source: res.source,
          staleAt: res.staleAt.toISOString(),
          sourceEndpoint: SosoEndpoint.NewsFeatured,
        };
      },
    }),

    readSsiIndex: tool({
      description:
        "Read NAV, composition, and total supply for a single SSI index on Base.",
      inputSchema: z.object({
        index: z.enum(SSI_INDEX_KEYS as [SsiIndexKey, ...SsiIndexKey[]]),
      }),
      execute: async ({ index }) => {
        return readIndexSnapshot(index);
      },
    }),

    readAllSsiIndexes: tool({
      description:
        "Read snapshots for MAG7, DEFI, MEME, and USSI in one call. Prefer this over individual reads.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        return readAllIndexSnapshots();
      },
    }),

    submitThesis: tool({
      description:
        "Submit the final thesis. The server validates against ThesisSchema and rejects on failure. Call exactly once per run.",
      // Plain object schema at the boundary; the full refinement runs inside execute.
      inputSchema: ThesisPayloadSchema,
      execute: async (thesis) => {
        const parsed = ThesisSchema.safeParse(thesis);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`);
          logger.warn("agent.thesis_rejected", { issues });
          return {
            ok: false,
            errors: issues,
          } as const;
        }
        capture.thesis = parsed.data;
        logger.info("agent.thesis_captured", { id: parsed.data.id });
        return { ok: true, id: parsed.data.id } as const;
      },
    }),
  };
}
