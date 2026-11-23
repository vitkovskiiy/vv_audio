/**
 * spec.md (Завдання 3): mutation score ≥ 80% for EACH mutated module, not just overall.
 * Stryker's own `break` threshold only looks at the total, so this reads its JSON report
 * and fails if any single file is below the bar. Prints the survivors to classify.
 */
import { readFileSync } from 'node:fs';

const THRESHOLD = 80;
const REPORT = 'reports/mutation/mutation.json';

interface Mutant {
  id: string;
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: { line: number; column: number } };
}
interface Report {
  files: Record<string, { mutants: Mutant[] }>;
}

const report = JSON.parse(readFileSync(REPORT, 'utf8')) as Report;
const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

let failed = false;
console.log(`\nmutation score per file (gate: ≥ ${THRESHOLD}%)`);
for (const [file, { mutants }] of Object.entries(report.files)) {
  const detected = mutants.filter((m) => DETECTED.has(m.status)).length;
  const undetected = mutants.filter((m) => UNDETECTED.has(m.status));
  const valid = detected + undetected.length;
  const score = valid ? (detected / valid) * 100 : 100;
  const ok = score >= THRESHOLD;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${score.toFixed(2).padStart(6)}%  ${file}  (${detected}/${valid} killed)`);
  for (const m of undetected) {
    const { line, column } = m.location.start;
    console.log(
      `       ${m.status.padEnd(10)} #${m.id} ${file}:${line}:${column} ${m.mutatorName} → ${JSON.stringify(m.replacement ?? '')}`,
    );
  }
}
console.log(`\nfull report: ${REPORT.replace('.json', '.html')}`);
process.exit(failed ? 1 : 0);
