import puppeteer from '@cloudflare/puppeteer';

const ATS_PATTERNS = [
  { pattern: /greenhouse\.io/i,        name: "Greenhouse" },
  { pattern: /lever\.co/i,             name: "Lever" },
  { pattern: /myworkdayjobs\.com/i,    name: "Workday" },
  { pattern: /taleo\.net/i,            name: "Taleo" },
  { pattern: /icims\.com/i,            name: "iCIMS" },
  { pattern: /bamboohr\.com/i,         name: "BambooHR" },
  { pattern: /smartrecruiters\.com/i,  name: "SmartRecruiters" },
  { pattern: /workable\.com/i,         name: "Workable" },
  { pattern: /jobvite\.com/i,          name: "Jobvite" },
  { pattern: /rippling\.com/i,         name: "Rippling" },
  { pattern: /successfactors\.com/i,   name: "SAP SuccessFactors" },
  { pattern: /oraclecloud\.com/i,      name: "Oracle HCM" },
  { pattern: /ashbyhq\.com/i,          name: "Ashby" },
  { pattern: /breezy\.hr/i,            name: "Breezy HR" },
  { pattern: /recruitee\.com/i,        name: "Recruitee" },
  { pattern: /pinpointhq\.com/i,       name: "Pinpoint" },
  { pattern: /jazzhr\.com|resumatorjobs\.com/i, name: "JazzHR" },
  { pattern: /paylocity\.com/i,        name: "Paylocity" },
  { pattern: /paycom\.com/i,           name: "Paycom" },
  { pattern: /adp\.com/i,              name: "ADP" },
  { pattern: /ultipro\.com|ukg\.com/i, name: "UKG" },
  { pattern: /applytojob\.com/i,       name: "ApplicantPro" },
  { pattern: /jobscore\.com/i,         name: "JobScore" },
  { pattern: /comeet\.co/i,            name: "Comeet" },
  { pattern: /dover\.com/i,            name: "Dover" },
  { pattern: /gusto\.com/i,            name: "Gusto" },
];

const CAREER_PATHS = [
  "/careers", "/jobs", "/about/careers", "/about/jobs",
  "/company/careers", "/company/jobs", "/work-with-us",
  "/join-us", "/join-our-team", "/hiring", "/positions",
  "/open-positions", "/opportunities",
];

// Monthly browser session cap — adjust to control spend
const MONTHLY_SESSION_CAP = 500;

function detectATS(html, url) {
  const results = new Map();

  if (url) {
    for (const { pattern, name } of ATS_PATTERNS) {
      if (pattern.test(url)) results.set(name, url);
    }
  }

  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    for (const { pattern, name } of ATS_PATTERNS) {
      if (pattern.test(href) && !results.has(name)) results.set(name, href);
    }
  }

  for (const { pattern, name } of ATS_PATTERNS) {
    if (!results.has(name) && pattern.test(html)) {
      const m = html.match(new RegExp(`https?://[^"' <>]*${pattern.source}[^"' <>]*`, "i"));
      results.set(name, m ? m[0] : null);
    }
  }

  return Array.from(results.entries()).map(([name, url]) => ({ name, url }));
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ATSDetector/1.0; +https://ats.burkeruder.ai)",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    cf: { timeout: 10000 },
  });
  if (!res.ok) return null;
  return { html: await res.text(), finalUrl: res.url };
}

async function fetchWithBrowser(url, browser) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
    const html = await page.content();
    const finalUrl = page.url();
    return { html, finalUrl };
  } finally {
    await page.close();
  }
}

// Returns current month key e.g. "browser_sessions:2026-07"
function monthKey() {
  const d = new Date();
  return `browser_sessions:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function checkAndIncrementUsage(env) {
  if (!env.USAGE) return { allowed: true, count: 0, cap: MONTHLY_SESSION_CAP };

  const key = monthKey();
  const current = parseInt((await env.USAGE.get(key)) || "0", 10);

  if (current >= MONTHLY_SESSION_CAP) {
    return { allowed: false, count: current, cap: MONTHLY_SESSION_CAP };
  }

  // Increment — expires after 35 days so it auto-cleans
  await env.USAGE.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 * 35 });
  return { allowed: true, count: current + 1, cap: MONTHLY_SESSION_CAP };
}

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  let domain = (searchParams.get("domain") || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

  if (!domain) {
    return Response.json({ error: "Missing domain parameter" }, { status: 400 });
  }

  const base = `https://${domain}`;
  const urlsToCheck = [base, ...CAREER_PATHS.map(p => base + p)];

  const checkedUrls = [];
  const allMatches = new Map();
  let usedBrowser = false;
  let browserLimitReached = false;

  // ── PASS 1: fast fetch ──
  for (const url of urlsToCheck) {
    try {
      const result = await fetchPage(url);
      if (!result) continue;
      checkedUrls.push(url);
      const matches = detectATS(result.html, result.finalUrl);
      for (const m of matches) {
        if (!allMatches.has(m.name)) allMatches.set(m.name, m.url);
      }
      if (matches.length > 0 && url !== base) break;
    } catch { /* skip */ }
  }

  // ── PASS 2: headless browser fallback (only if pass 1 found nothing) ──
  if (allMatches.size === 0 && context.env.BROWSER) {
    const usage = await checkAndIncrementUsage(context.env);

    if (!usage.allowed) {
      browserLimitReached = true;
    } else {
      let browser;
      try {
        browser = await puppeteer.launch(context.env.BROWSER);
        usedBrowser = true;

        // Try the most likely career URLs with the browser
        const browserTargets = [
          base + "/careers",
          base + "/jobs",
          base + "/about/careers",
        ];

        for (const url of browserTargets) {
          try {
            const result = await fetchWithBrowser(url, browser);
            checkedUrls.push(`${url} (browser)`);
            const matches = detectATS(result.html, result.finalUrl);
            for (const m of matches) {
              if (!allMatches.has(m.name)) allMatches.set(m.name, m.url);
            }
            if (allMatches.size > 0) break;
          } catch { /* skip */ }
        }
      } catch { /* browser unavailable */ } finally {
        if (browser) await browser.close();
      }
    }
  }

  const detected = Array.from(allMatches.entries()).map(([name, url]) => ({ name, url }));

  return Response.json({
    domain,
    detected,
    checkedUrls,
    found: detected.length > 0,
    usedBrowser,
    browserLimitReached,
  });
}
