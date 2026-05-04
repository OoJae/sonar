#!/usr/bin/env tsx
import "./_env";
import { envReport } from "@/lib/utils/env";

function main() {
  const report = envReport();
  const pad = Math.max(...report.map((r) => r.key.length));
  const rows = report
    .map((r) => {
      const mark = r.present ? "set" : "missing";
      return `  ${r.key.padEnd(pad)}  ${mark}`;
    })
    .join("\n");

  const missing = report.filter((r) => !r.present).map((r) => r.key);
  const present = report.filter((r) => r.present).length;

  console.log("Sonar env report");
  console.log("================");
  console.log(rows);
  console.log("");
  console.log(`  ${present}/${report.length} populated`);
  if (missing.length > 0) {
    console.log(`  missing: ${missing.join(", ")}`);
  }
}

main();
