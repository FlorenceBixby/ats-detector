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
  { pattern: /successfactors\.com|successfactors\.eu/i, name: "SAP SuccessFactors" },
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
  { pattern: /phenom\.com|phenompeople\.com/i, name: "Phenom" },
  { pattern: /eightfold\.ai/i,         name: "Eightfold" },
  { pattern: /paradox\.ai/i,           name: "Paradox" },
  { pattern: /talentreef\.com/i,       name: "TalentReef" },
  { pattern: /kronos\.com/i,           name: "UKG Kronos" },
  { pattern: /kenexa\.com/i,           name: "IBM Kenexa" },
  { pattern: /silkroad\.com/i,         name: "SilkRoad" },
  { pattern: /csod\.com|cornerstoneondemand\.com/i, name: "Cornerstone" },
  { pattern: /workstream\.us/i,        name: "Workstream" },
  { pattern: /dayforce\.com|ceridian\.com/i, name: "Dayforce" },
  { pattern: /personio\.com|personio\.de/i, name: "Personio" },
  { pattern: /bullhorn\.com/i,         name: "Bullhorn" },
  { pattern: /teamtailor\.com/i,       name: "Teamtailor" },
  { pattern: /recruitcrm\.io/i,        name: "RecruitCRM" },
  { pattern: /zohorecruit\.com|recruit\.zoho\.com/i, name: "Zoho Recruit" },
  { pattern: /hibob\.com/i,            name: "Bob (HiBob)" },
  { pattern: /fountain\.com/i,         name: "Fountain" },
];

const CAREER_PATHS = [
  "/careers", "/jobs", "/about/careers", "/about/jobs",
  "/company/careers", "/company/jobs", "/work-with-us",
  "/join-us", "/join-our-team", "/hiring", "/positions",
  "/open-positions", "/opportunities",
];

const CAREER_SUBDOMAINS = ["careers", "jobs", "work", "hire", "talent", "apply"];

const MONTHLY_SESSION_CAP = 500;

// Derive candidate slugs from a domain — tries the primary name + dehyphenated variant
function domainToSlugs(domain) {
  const clean = domain.replace(/^www\./, '');
  // Strip TLD(s): handle .co.uk, .com.au, etc.
  const parts = clean.split('.');
  const slug = parts[0].toLowerCase();
  const slugNoDash = slug.replace(/-/g, '');
  return slug === slugNoDash ? [slug] : [slug, slugNoDash];
}

// Vendor index probes — these vendors expose public customer pages at predictable URLs.
// A 200 response (with final URL still on the vendor domain) confirms the company is a customer.
function buildVendorProbes(slugs) {
  const probes = [];
  for (const slug of slugs) {
    probes.push(
      { url: `https://boards.greenhouse.io/${slug}`,         name: "Greenhouse",        mustContain: "boards.greenhouse.io" },
      { url: `https://jobs.lever.co/${slug}`,                name: "Lever",             mustContain: "jobs.lever.co" },
      { url: `https://jobs.ashbyhq.com/${slug}`,             name: "Ashby",             mustContain: "jobs.ashbyhq.com" },
      { url: `https://apply.workable.com/${slug}`,           name: "Workable",          mustContain: "apply.workable.com" },
      { url: `https://careers.smartrecruiters.com/${slug}`,  name: "SmartRecruiters",   mustContain: "smartrecruiters.com" },
      { url: `https://${slug}.bamboohr.com/jobs/`,           name: "BambooHR",          mustContain: `${slug}.bamboohr.com` },
      { url: `https://${slug}.recruitee.com`,                name: "Recruitee",         mustContain: `${slug}.recruitee.com` },
      { url: `https://${slug}.breezy.hr`,                    name: "Breezy HR",         mustContain: `${slug}.breezy.hr` },
      { url: `https://jobs.jobvite.com/${slug}`,             name: "Jobvite",           mustContain: "jobvite.com" },
      { url: `https://${slug}.teamtailor.com/jobs`,          name: "Teamtailor",        mustContain: `${slug}.teamtailor.com` },
      // Workday instances — companies are assigned one of these numbered shards
      ...["wd1","wd3","wd5","wd12","wd102"].map(shard => ({
        url: `https://${slug}.${shard}.myworkdayjobs.com/careers`,
        name: "Workday",
        mustContain: "myworkdayjobs.com",
      })),
    );
  }
  return probes;
}

async function probeVendor({ url, name, mustContain }) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ATSDetector/1.0; +https://ats.burkeruder.ai)" },
      redirect: "follow",
      cf: { timeout: 8000 },
    });
    if (!res.ok) return null;
    // Guard against redirects to vendor homepage (false positive)
    if (!res.url.includes(mustContain)) return null;
    return { name, url: res.url };
  } catch {
    return null;
  }
}

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

function monthKey() {
  const d = new Date();
  return `browser_sessions:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function checkAndIncrementUsage(env) {
  if (!env.USAGE) return { allowed: true, count: 0, cap: MONTHLY_SESSION_CAP };
  const key = monthKey();
  const current = parseInt((await env.USAGE.get(key)) || "0", 10);
  if (current >= MONTHLY_SESSION_CAP) return { allowed: false, count: current, cap: MONTHLY_SESSION_CAP };
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
  const subdomainBases = CAREER_SUBDOMAINS.map(s => `https://${s}.${domain}`);
  const urlsToCheck = [base, ...subdomainBases, ...CAREER_PATHS.map(p => base + p)];

  const checkedUrls = [];
  const allMatches = new Map();
  let usedBrowser = false;
  let browserLimitReached = false;

  // ── PASS 1: fast fetch (domain + subdomains + career paths) ──
  for (const url of urlsToCheck) {
    try {
      const result = await fetchPage(url);
      if (!result) continue;
      checkedUrls.push(url);
      const matches = detectATS(result.html, result.finalUrl);
      for (const m of matches) {
        if (!allMatches.has(m.name)) allMatches.set(m.name, m.url);
      }
      if (matches.length > 0) break;
    } catch { /* skip */ }
  }

  // ── PASS 2: vendor index probes (free, parallel — no browser needed) ──
  // Greenhouse, Lever, Ashby, Workday etc. expose public customer pages at known URLs.
  // Run all probes simultaneously; first hit wins.
  if (allMatches.size === 0) {
    const slugs = domainToSlugs(domain);
    const probes = buildVendorProbes(slugs);
    checkedUrls.push(`[vendor index probes: ${slugs.join(', ')}]`);

    const results = await Promise.allSettled(probes.map(probeVendor));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        const { name, url } = r.value;
        if (!allMatches.has(name)) allMatches.set(name, url);
      }
    }
  }

  // ── PASS 3: headless browser fallback (costs a session — last resort) ──
  if (allMatches.size === 0 && context.env.BROWSER) {
    const usage = await checkAndIncrementUsage(context.env);

    if (!usage.allowed) {
      browserLimitReached = true;
    } else {
      let browser;
      try {
        browser = await puppeteer.launch(context.env.BROWSER);
        usedBrowser = true;

        const browserTargets = [
          ...CAREER_SUBDOMAINS.map(s => `https://${s}.${domain}`),
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
