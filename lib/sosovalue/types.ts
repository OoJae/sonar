import { z } from "zod";

// SoSoValue OpenAPI shapes. Verified against the live API at
// https://openapi.sosovalue.com/openapi/v1 on 2026-05-03.
//
// The published GitBook docs (https://sosovalue-1.gitbook.io/sosovalue-api-doc)
// don't match the live API in two annoying ways:
//   1. Most endpoints return a `{code, message, data}` envelope. The docs
//      sometimes show only the inner `data` array as the response.
//   2. The news endpoints use camelCase params + fields (pageNum, pageSize,
//      releaseTime, matchedCurrencies, multilanguageContent), even though the
//      docs spell them snake_case. The ETF endpoints stay snake_case in
//      payload bodies.
// We trust the live wire format here; if SoSoValue ever cleans up its docs we
// can revisit.

const Envelope = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      code: z.number().optional(),
      message: z.string().nullable().optional(),
      msg: z.string().nullable().optional(),
      data: data,
    })
    .passthrough();

// --- 1.1 Currency List: GET /openapi/v1/currencies -------------------------

export const CurrencyListItemSchema = z
  .object({
    currency_id: z.string(),
    symbol: z.string(),
    name: z.string(),
  })
  .passthrough();
export type CurrencyListItem = z.infer<typeof CurrencyListItemSchema>;

export const CurrencyListResponseSchema = Envelope(
  z.array(CurrencyListItemSchema),
);
export type CurrencyListResponse = z.infer<typeof CurrencyListResponseSchema>;

// --- 2.1 ETF Summary History: GET /openapi/v1/etfs/summary-history ---------

export const EtfSummaryHistoryItemSchema = z
  .object({
    date: z.string(),
    total_net_inflow: z.number().nullable(),
    total_value_traded: z.number().nullable().optional(),
    total_net_assets: z.number().nullable().optional(),
    cum_net_inflow: z.number().nullable().optional(),
  })
  .passthrough();
export type EtfSummaryHistoryItem = z.infer<typeof EtfSummaryHistoryItemSchema>;

export const EtfSummaryHistoryResponseSchema = Envelope(
  z.array(EtfSummaryHistoryItemSchema),
);
export type EtfSummaryHistoryResponse = z.infer<
  typeof EtfSummaryHistoryResponseSchema
>;

// --- 2.2 ETF List: GET /openapi/v1/etfs ------------------------------------

export const EtfListItemSchema = z
  .object({
    ticker: z.string(),
    name: z.string(),
    exchange: z.string().optional(),
  })
  .passthrough();
export type EtfListItem = z.infer<typeof EtfListItemSchema>;

export const EtfListResponseSchema = Envelope(z.array(EtfListItemSchema));
export type EtfListResponse = z.infer<typeof EtfListResponseSchema>;

// --- 6.3 Featured News: GET /openapi/v1/news/featured ----------------------
// Query params live API expects: pageNum (int, required), pageSize (int).

export const MatchedCurrencySchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    fullName: z.string().optional(),
    full_name: z.string().optional(),
  })
  .passthrough();

export const NewsTranslationSchema = z
  .object({
    language: z.string(),
    title: z.string(),
    content: z.string().optional(),
  })
  .passthrough();

export const NewsItemSchema = z
  .object({
    id: z.string(),
    sourceLink: z.string().optional(),
    originalLink: z.string().nullable().optional(),
    releaseTime: z.number().optional(),
    author: z.string().nullable().optional(),
    category: z.number().int().optional(),
    matchedCurrencies: z.array(MatchedCurrencySchema).optional(),
    tags: z.array(z.string()).optional(),
    multilanguageContent: z.array(NewsTranslationSchema).optional(),
  })
  .passthrough();
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const NewsFeaturedResponseSchema = Envelope(
  z
    .object({
      pageNum: z.number().optional(),
      pageSize: z.number().optional(),
      totalPage: z.number().optional(),
      total: z.number().optional(),
      list: z.array(NewsItemSchema),
    })
    .passthrough(),
);
export type NewsFeaturedResponse = z.infer<typeof NewsFeaturedResponseSchema>;

export const SosoEndpoint = {
  CurrencyList: "/openapi/v1/currencies",
  NewsFeatured: "/openapi/v1/news/featured",
  EtfList: "/openapi/v1/etfs",
  EtfSummaryHistory: "/openapi/v1/etfs/summary-history",
} as const;
export type SosoEndpointName = keyof typeof SosoEndpoint;

export type CachedResponse<T> = {
  data: T;
  staleAt: Date;
  source: "live" | "fixture" | "cache";
};

// Helper: extract a normalized title from a news item, picking English first.
export function newsItemTitle(item: NewsItem): string | null {
  const translations = item.multilanguageContent ?? [];
  const en = translations.find((t) => t.language === "en");
  return en?.title ?? translations[0]?.title ?? null;
}
