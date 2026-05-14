/**
 * Playwright workflow analyzer for https://higgsfield.ai/ai/video
 *
 * Goals:
 * - Render the JavaScript application in a real browser context.
 * - Extract likely UI anchors for prompt input, reference upload, model picker,
 *   generate button, and result area.
 * - Capture XHR/fetch request URLs, payload previews, and response shapes.
 * - Save a machine-readable JSON report plus key screenshots.
 *
 * Run from the repository root:
 *
 *   PLAYWRIGHT_MODULE_PATH=/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
 *   node --experimental-strip-types scripts/higgsfield-analysis/analyze-higgsfield-video.ts
 *
 * If Playwright is installed in this project, PLAYWRIGHT_MODULE_PATH can be omitted.
 *
 * Safety note:
 * The script does not click "Generate" by default because that may consume paid
 * credits on an authenticated account. Set ATTEMPT_GENERATE=true only when you
 * explicitly want to test the generation request path.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface NetworkRecord {
  phase: 'request' | 'response' | 'requestfailed';
  method?: string;
  resourceType?: string;
  url: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: JsonValue | string | null;
  responseShape?: JsonValue | string | null;
  failure?: string | null;
  timestamp: string;
}

interface Candidate {
  kind: string;
  score: number;
  selector: string;
  tagName: string;
  role: string | null;
  text: string;
  placeholder: string | null;
  ariaLabel: string | null;
  type: string | null;
  className: string | null;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface ScreenshotRecord {
  name: string;
  path: string;
  selector?: string;
  success: boolean;
  error?: string;
}

interface AnalysisReport {
  targetUrl: string;
  finalUrl: string;
  title: string;
  capturedAt: string;
  viewport: { width: number; height: number };
  domOutline: JsonValue;
  candidates: Record<string, Candidate[]>;
  selectedSelectors: Record<string, string | null>;
  network: NetworkRecord[];
  screenshots: ScreenshotRecord[];
  pageObjectModel: string;
  workflowHypothesis: string[];
  automationNotes: string[];
}

const require = createRequire(import.meta.url);
const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright';
const { chromium } = require(playwrightModulePath);

const TARGET_URL = process.env.TARGET_URL || 'https://higgsfield.ai/ai/video';
const OUTPUT_DIR =
  process.env.OUTPUT_DIR ||
  path.resolve(process.cwd(), 'analysis/higgsfield-video');
const ATTEMPT_GENERATE = process.env.ATTEMPT_GENERATE === 'true';
const VIEWPORT = { width: 1440, height: 2200 };

function nowIso(): string {
  return new Date().toISOString();
}

function tryParseJson(value: string | null): JsonValue | string | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value.length > 5000 ? `${value.slice(0, 5000)}...<truncated>` : value;
  }
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const secretPattern = /authorization|cookie|token|secret|key|session/i;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    output[key] = secretPattern.test(key) ? '<redacted>' : value;
  }
  return output;
}

function shapeOf(value: unknown, depth = 0): JsonValue {
  if (depth > 4) return '<max-depth>';
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeOf(value[0], depth + 1)];
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      result[key] = shapeOf(child, depth + 1);
    }
    return result;
  }
  return typeof value;
}

async function safeResponseShape(response: any): Promise<JsonValue | string | null> {
  const contentType = response.headers()['content-type'] || '';
  if (!/json|text|graphql|javascript/i.test(contentType)) return null;

  try {
    if (/json|graphql/i.test(contentType)) {
      const json = await response.json();
      return shapeOf(json);
    }
    const text = await response.text();
    return text.length > 2000 ? `${text.slice(0, 2000)}...<truncated>` : text;
  } catch (error) {
    return `Unable to read response body: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function buildPomSource(selectors: Record<string, string | null>): string {
  const prompt = selectors.promptInput || 'textarea, [contenteditable="true"], input[type="text"]';
  const upload = selectors.referenceUpload || 'input[type="file"], [data-testid*="upload" i]';
  const generate = selectors.generateButton || 'button:has-text("Generate")';
  const model = selectors.modelSelector || '[role="combobox"], button:has-text("Model")';
  const results = selectors.videoResults || 'video, [data-testid*="result" i]';

  return `import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page Object Model for Higgsfield's AI video page.
 * Selectors were generated heuristically. Prefer replacing them with stable
 * data-testid selectors if Higgsfield exposes any in your authenticated session.
 */
export class HiggsfieldVideoPage {
  readonly page: Page;
  readonly promptInput: Locator;
  readonly referenceUpload: Locator;
  readonly generateButton: Locator;
  readonly modelSelector: Locator;
  readonly videoResults: Locator;

  constructor(page: Page) {
    this.page = page;
    this.promptInput = page.locator(${JSON.stringify(prompt)}).first();
    this.referenceUpload = page.locator(${JSON.stringify(upload)}).first();
    this.generateButton = page.locator(${JSON.stringify(generate)}).first();
    this.modelSelector = page.locator(${JSON.stringify(model)}).first();
    this.videoResults = page.locator(${JSON.stringify(results)}).first();
  }

  async goto() {
    await this.page.goto('https://higgsfield.ai/ai/video', { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('body');
    await this.page.waitForLoadState('networkidle').catch(() => undefined);
  }

  async setPrompt(prompt: string) {
    await expect(this.promptInput).toBeVisible();
    await this.promptInput.fill(prompt);
  }

  async uploadReferenceImage(filePath: string) {
    await expect(this.referenceUpload).toBeAttached();
    await this.referenceUpload.setInputFiles(filePath);
  }

  async openModelPicker() {
    await expect(this.modelSelector).toBeVisible();
    await this.modelSelector.click();
  }

  /**
   * Keep dryRun=true unless you intentionally want to consume credits.
   */
  async generate(options: { dryRun?: boolean } = {}) {
    await expect(this.generateButton).toBeVisible();
    if (options.dryRun !== false) return;
    await this.generateButton.click();
  }
}
`;
}

async function captureLocatorScreenshot(
  page: any,
  selector: string | null,
  name: string,
  screenshots: ScreenshotRecord[],
) {
  if (!selector) {
    screenshots.push({ name, path: '', success: false, error: 'No selector found' });
    return;
  }

  const outputPath = path.join(OUTPUT_DIR, `${name}.png`);
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 5000 });
    await locator.screenshot({ path: outputPath });
    screenshots.push({ name, selector, path: outputPath, success: true });
  } catch (error) {
    screenshots.push({
      name,
      selector,
      path: outputPath,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function dismissCommonOverlays(page: any) {
  const dismissButtons = [
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("Close")',
    'button:has-text("Skip")',
  ];

  for (const selector of dismissButtons) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
}

async function analyzeDom(page: any) {
  return page.evaluate(() => {
    const MAX_TEXT = 160;

    function textOf(el: Element) {
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    }

    function isVisible(el: Element) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 2 &&
        rect.height > 2
      );
    }

    function cssPath(el: Element) {
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        const id = current.getAttribute('id');
        const testId = current.getAttribute('data-testid');
        const aria = current.getAttribute('aria-label');

        if (id) {
          selector += `#${CSS.escape(id)}`;
          parts.unshift(selector);
          break;
        }

        if (testId) {
          selector += `[data-testid="${CSS.escape(testId)}"]`;
          parts.unshift(selector);
          break;
        }

        if (aria && aria.length < 80) {
          selector += `[aria-label="${CSS.escape(aria)}"]`;
        } else {
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(
              sibling => sibling.tagName === current!.tagName,
            );
            if (siblings.length > 1) {
              selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
          }
        }

        parts.unshift(selector);
        current = current.parentElement;
      }
      return `body > ${parts.join(' > ')}`;
    }

    function attrs(el: Element) {
      return {
        tagName: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        text: textOf(el),
        placeholder: el.getAttribute('placeholder'),
        ariaLabel: el.getAttribute('aria-label'),
        type: el.getAttribute('type'),
        className: el.getAttribute('class'),
        selector: cssPath(el),
        boundingBox: (() => {
          const rect = el.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })(),
      };
    }

    function scoreCandidate(el: Element, kind: string) {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const aria = el.getAttribute('aria-label') || '';
      const type = el.getAttribute('type') || '';
      const cls = el.getAttribute('class') || '';
      const text = textOf(el);
      const combined = `${tag} ${role} ${placeholder} ${aria} ${type} ${cls} ${text}`.toLowerCase();
      const rect = el.getBoundingClientRect();
      let score = isVisible(el) ? 5 : -10;

      if (kind === 'promptInput') {
        if (tag === 'textarea') score += 50;
        if (tag === 'input' && /text|search/.test(type)) score += 25;
        if ((el as HTMLElement).isContentEditable) score += 35;
        if (/prompt|describe|description|idea|text|ask|type|what do you want/i.test(combined)) score += 25;
        if (rect.width > 250 && rect.height > 40) score += 10;
      }

      if (kind === 'referenceUpload') {
        if (tag === 'input' && type === 'file') score += 60;
        if (/upload|reference|image|photo|frame|drag|drop|asset/i.test(combined)) score += 35;
        if (rect.width > 100 && rect.height > 80) score += 8;
      }

      if (kind === 'generateButton') {
        if (tag === 'button' || role === 'button') score += 35;
        if (/generate|create|make|submit|start|render/i.test(combined)) score += 45;
        if (/video/i.test(combined)) score += 10;
      }

      if (kind === 'modelSelector') {
        if (tag === 'select' || role === 'combobox' || role === 'listbox') score += 40;
        if (tag === 'button') score += 8;
        if (/model|seedance|kling|veo|sora|wan|runway|luma|higgsfield/i.test(combined)) score += 45;
      }

      if (kind === 'videoResults') {
        if (tag === 'video') score += 80;
        if (/result|history|library|generation|output|video|recent/i.test(combined)) score += 25;
        if (rect.width > 250 && rect.height > 180) score += 10;
      }

      return Math.round(score);
    }

    function collect(kind: string) {
      const selector =
        'textarea,input,[contenteditable="true"],button,select,[role="button"],[role="combobox"],[role="listbox"],video,img,section,main,div';
      return Array.from(document.querySelectorAll(selector))
        .map(el => ({ kind, score: scoreCandidate(el, kind), ...attrs(el) }))
        .filter(item => item.score > 20)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
    }

    function outline(el: Element, depth = 0): unknown {
      if (depth > 4) return null;
      const children = Array.from(el.children)
        .filter(child => !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(child.tagName))
        .slice(0, 12)
        .map(child => outline(child, depth + 1))
        .filter(Boolean);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        id: el.getAttribute('id'),
        className: (el.getAttribute('class') || '').slice(0, 100),
        text: textOf(el),
        visible: isVisible(el),
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        children,
      };
    }

    return {
      outline: outline(document.body),
      candidates: {
        promptInput: collect('promptInput'),
        referenceUpload: collect('referenceUpload'),
        generateButton: collect('generateButton'),
        modelSelector: collect('modelSelector'),
        videoResults: collect('videoResults'),
      },
      visibleText: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 5000),
    };
  });
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const network: NetworkRecord[] = [];
  const screenshots: ScreenshotRecord[] = [];

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  // This is a no-op interception hook, included so later runs can add blocking,
  // mocking, or payload inspection in one place.
  await context.route('**/*', route => route.continue());

  const page = await context.newPage();

  page.on('request', request => {
    if (!['xhr', 'fetch', 'document'].includes(request.resourceType())) return;
    network.push({
      phase: 'request',
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      requestHeaders: redactHeaders(request.headers()),
      postData: tryParseJson(request.postData()),
      timestamp: nowIso(),
    });
  });

  page.on('response', async response => {
    const request = response.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    network.push({
      phase: 'response',
      resourceType: request.resourceType(),
      url: response.url(),
      status: response.status(),
      responseHeaders: redactHeaders(response.headers()),
      responseShape: await safeResponseShape(response),
      timestamp: nowIso(),
    });
  });

  page.on('requestfailed', request => {
    network.push({
      phase: 'requestfailed',
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      failure: request.failure()?.errorText || null,
      timestamp: nowIso(),
    });
  });

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('body', { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(2_500);
  await dismissCommonOverlays(page);

  // Scroll once to force lazy sections and result/library panels to hydrate.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1_000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1_000);

  const dom = await analyzeDom(page);
  const candidates = dom.candidates as Record<string, Candidate[]>;
  const selectedSelectors: Record<string, string | null> = {
    promptInput: candidates.promptInput?.[0]?.selector || null,
    referenceUpload: candidates.referenceUpload?.[0]?.selector || null,
    generateButton: candidates.generateButton?.[0]?.selector || null,
    modelSelector: candidates.modelSelector?.[0]?.selector || null,
    videoResults: candidates.videoResults?.[0]?.selector || null,
  };

  const fullPagePath = path.join(OUTPUT_DIR, 'full-page.png');
  await page.screenshot({ path: fullPagePath, fullPage: true });
  screenshots.push({ name: 'full-page', path: fullPagePath, success: true });

  await captureLocatorScreenshot(page, selectedSelectors.promptInput, 'prompt-input', screenshots);
  await captureLocatorScreenshot(page, selectedSelectors.referenceUpload, 'reference-upload', screenshots);
  await captureLocatorScreenshot(page, selectedSelectors.modelSelector, 'model-selector', screenshots);
  await captureLocatorScreenshot(page, selectedSelectors.generateButton, 'generate-button', screenshots);
  await captureLocatorScreenshot(page, selectedSelectors.videoResults, 'video-results', screenshots);

  if (ATTEMPT_GENERATE && selectedSelectors.promptInput && selectedSelectors.generateButton) {
    await page.locator(selectedSelectors.promptInput).first().fill(
      'A cinematic 5 second vertical shot of a detective entering a rainy neon alley.',
    );
    await page.locator(selectedSelectors.generateButton).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(3_000);
  }

  const pomSource = buildPomSource(selectedSelectors);
  const pomPath = path.join(OUTPUT_DIR, 'higgsfield-video.pom.ts');
  await writeFile(pomPath, pomSource, 'utf8');

  const report: AnalysisReport = {
    targetUrl: TARGET_URL,
    finalUrl: page.url(),
    title: await page.title(),
    capturedAt: nowIso(),
    viewport: VIEWPORT,
    domOutline: dom.outline as JsonValue,
    candidates,
    selectedSelectors,
    network,
    screenshots,
    pageObjectModel: pomPath,
    workflowHypothesis: [
      'Landing/navigation shell loads first, then the video generation workspace hydrates via client-side JavaScript.',
      'The core production workflow is likely: choose video model/preset, provide prompt, optionally upload reference assets, configure motion or aspect ratio, then submit a generation task.',
      'Generation APIs are expected to be asynchronous: submit returns a job/task identifier, then the client polls or subscribes until a result video URL appears.',
      'Public unauthenticated sessions may expose the UI shell but gate generation behind login, profile, library, or credit checks.',
    ],
    automationNotes: [
      'Keep generation clicks disabled by default to avoid consuming paid credits.',
      'Prefer stable role, aria-label, or data-testid selectors; CSS nth-of-type selectors are only a fallback.',
      'Persist authenticated state with browserContext.storageState() only in a private local file and never commit it.',
      'For AIYOU integration, reproduce the workflow abstraction rather than copying site-specific UI or private API contracts.',
    ],
  };

  await writeFile(path.join(OUTPUT_DIR, 'analysis.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'network.json'), JSON.stringify(network, null, 2), 'utf8');
  await writeFile(
    path.join(OUTPUT_DIR, 'page-structure.json'),
    JSON.stringify({ outline: dom.outline, candidates, selectedSelectors, visibleText: dom.visibleText }, null, 2),
    'utf8',
  );

  await browser.close();

  console.log(JSON.stringify({
    ok: true,
    outputDir: OUTPUT_DIR,
    finalUrl: report.finalUrl,
    title: report.title,
    selectedSelectors,
    networkRecords: network.length,
    screenshots: screenshots.filter(item => item.success).map(item => item.path),
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
