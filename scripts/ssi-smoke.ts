#!/usr/bin/env tsx
import "./_env";
import { readAllIndexSnapshots } from "@/lib/ssi/reader";

async function main() {
  console.log("Reading SSI index snapshots from Base mainnet...");
  const snapshots = await readAllIndexSnapshots();
  for (const s of snapshots) {
    console.log("---");
    console.log("index:        ", s.index);
    console.log("address:      ", s.address);
    console.log("name:         ", s.name);
    console.log("symbol:       ", s.symbol);
    console.log("decimals:     ", s.decimals);
    console.log("totalSupply:  ", s.totalSupply);
    console.log("navUSD:       ", s.navUSD);
    console.log("tokenset:     ", s.tokenset.length, "entries");
    for (const t of s.tokenset.slice(0, 5)) {
      console.log(`  ${t.symbol.padEnd(10)} chain=${t.chain.padEnd(10)} amount=${t.amount}`);
    }
    if (s.tokenset.length > 5) console.log(`  ... +${s.tokenset.length - 5} more`);
  }
  console.log("---");
  console.log(`Read ${snapshots.length} snapshot(s).`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
