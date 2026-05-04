import { config } from "dotenv";

// Import this module for side effects at the very top of any CLI script so
// that downstream imports (env.ts, db/client.ts) see the populated env.
// ES-module hoisting groups all imports together; loading dotenv from a
// separate module (rather than interleaving calls and imports) keeps the
// evaluation order deterministic.
config({ path: ".env.local" });
config();
