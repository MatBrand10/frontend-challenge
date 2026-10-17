import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { log } from 'node:console';
import process from 'node:process';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'reports/lighthouse');
const origin = process.env.LIGHTHOUSE_URL ?? 'http://127.0.0.1:4173';
const pages = [
  { name: 'home', path: '/' },
  { name: 'nft-detail', path: '/nft/nft-1' },
];
const profiles = ['mobile', 'desktop'];
const measurements = [];
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
let chromeVersion;

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

await mkdir(outputDirectory, { recursive: true });
const chrome = await launch({
  chromePath: process.env.CHROME_PATH,
  chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const versionResponse = await globalThis.fetch(`http://127.0.0.1:${chrome.port}/json/version`);
  if (!versionResponse.ok) {
    throw new Error(`Unable to read Chrome version (HTTP ${versionResponse.status})`);
  }
  const versionPayload = await versionResponse.json();
  if (
    typeof versionPayload !== 'object'
    || versionPayload === null
    || !('Browser' in versionPayload)
    || typeof versionPayload.Browser !== 'string'
  ) {
    throw new Error('Chrome returned an invalid version response');
  }
  chromeVersion = versionPayload.Browser;

  for (const page of pages) {
    for (const profile of profiles) {
      for (let run = 1; run <= 3; run += 1) {
        const url = new URL(page.path, origin).toString();
        const config = {
          extends: 'lighthouse:default',
          settings: {
            formFactor: profile,
            throttlingMethod: profile === 'mobile' ? 'simulate' : 'provided',
            screenEmulation: profile === 'mobile'
              ? { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false }
              : { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: true },
          },
        };
        const result = await lighthouse(url, {
          port: chrome.port,
          output: ['html', 'json'],
          logLevel: 'error',
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        }, config);
        if (!result) throw new Error(`Lighthouse returned no result for ${url}`);

        const stem = `${profile}-${page.name}-run-${run}`;
        const reports = Array.isArray(result.report) ? result.report : [result.report];
        const html = reports.find((item) => item.toLowerCase().includes('<!doctype html>'));
        const json = reports.find((item) => item.trimStart().startsWith('{'));
        if (!html || !json) throw new Error(`Lighthouse did not produce both reports for ${url}`);
        await writeFile(resolve(outputDirectory, `${stem}.html`), html);
        await writeFile(resolve(outputDirectory, `${stem}.json`), json);

        const scores = Object.fromEntries(
          Object.entries(result.lhr.categories).map(([key, category]) => [key, Math.round((category.score ?? 0) * 100)]),
        );
        const audits = result.lhr.audits;
        measurements.push({
          page: page.name,
          profile,
          run,
          url,
          scores,
          metrics: {
            lcpMs: audits['largest-contentful-paint'].numericValue,
            cls: audits['cumulative-layout-shift'].numericValue,
            tbtMs: audits['total-blocking-time'].numericValue,
          },
        });
        log(`${profile} ${page.path} run ${run}: Performance ${scores.performance}, Accessibility ${scores.accessibility}, Best Practices ${scores['best-practices']}, SEO ${scores.seo}`);
      }
    }
  }
} finally {
  await chrome.kill();
}

const summary = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    lighthouse: packageJson.devDependencies.lighthouse,
    chrome: chromeVersion,
    origin,
    scenario: 'default MSW fixtures',
    runsPerPageAndProfile: 3,
  },
  measurements,
  medians: pages.flatMap((page) => profiles.map((profile) => {
    const records = measurements.filter((item) => item.page === page.name && item.profile === profile);
    const scoreKeys = ['performance', 'accessibility', 'best-practices', 'seo'];
    return {
      page: page.name,
      profile,
      scores: Object.fromEntries(scoreKeys.map((key) => [key, median(records.map((item) => item.scores[key]))])),
      metrics: {
        lcpMs: median(records.map((item) => item.metrics.lcpMs)),
        cls: median(records.map((item) => item.metrics.cls)),
        tbtMs: median(records.map((item) => item.metrics.tbtMs)),
      },
    };
  })),
};

await writeFile(resolve(outputDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
log('\nMedian Lighthouse results (3 runs each):');
for (const record of summary.medians) {
  log(`${record.profile} ${record.page}: ${JSON.stringify(record.scores)} | LCP ${Math.round(record.metrics.lcpMs)} ms | CLS ${record.metrics.cls.toFixed(3)} | TBT ${Math.round(record.metrics.tbtMs)} ms`);
}
