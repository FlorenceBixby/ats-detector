const ATS_PATTERNS = [
  { pattern: /greenhouse\.io/i, name: "Greenhouse" },
  { pattern: /lever\.co/i, name: "Lever" },
  { pattern: /myworkdayjobs\.com/i, name: "Workday" },
  { pattern: /taleo\.net/i, name: "Taleo" },
  { pattern: /icims\.com/i, name: "iCIMS" },
  { pattern: /bamboohr\.com/i, name: "BambooHR" },
  { pattern: /smartrecruiters\.com/i, name: "SmartRecruiters" },
  { pattern: /workable\.com/i, name: "Workable" },
  { pattern: /jobvite\.com/i, name: "Jobvite" },
  { pattern: /rippling\.com/i, name: "Rippling" },
  { pattern: /successfactors\.com/i, name: "SAP SuccessFactors" },
  { pattern: /oraclecloud\.com/i, name: "Oracle HCM" },
  { pattern: /ashbyhq\.com/i, name: "Ashby" },
  { pattern: /breezy\.hr/i, name: "Breezy HR" },
  { pattern: /recruitee\.com/i, name: "Recruitee" },
  { pattern: /pinpointhq\.com/i, name: "Pinpoint" },
  { pattern: /jazzhr\.com|resumatorjobs\.com/i, name: "JazzHR" },
  { pattern: /paylocity\.com/i, name: "Paylocity" },
  { pattern: /paycom\.com/i, name: "Paycom" },
  { pattern: /adp\.com/i, name: "ADP" },
  { pattern: /ultipro\.com|ukg\.com/i, name: "UKG" },
  { pattern: /applytojob\.com/i, name: "ApplicantPro" },
  { pattern: /jobscore\.com/i, name: "JobScore" },
  { pattern: /comeet\.co/i, name: "Comeet" },
  { pattern: /dover\.com/i, name: "Dover" },
  { pattern: /rippling\.com/i, name: "Rippling" },
  { pattern: /gusto\.com/i, name: "Gusto" },
];

const CAREER_PATHS = [
  "/careers",
  "/jobs",
  "/about/careers",
  "/about/jobs",
  "/company/careers",
  "/company/jobs",
  "/work-with-us",
  "/join-us",
  "/join-our-team",
  "/hiring",
  "/positions",
  "/open-positions",
  "/opportunities",
];

function detectATS(html, url) {
  const results = new Map();

  // Check the page URL itself
  for (const { pattern, name } of ATS_PATTERNS) {
    if (pattern.test(url)) {
      results.set(name, url);
    }
  }

  // Extract all href attributes from the HTML
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    for (const { pattern, name } of ATS_PATTERNS) {
      if (pattern.test(href) && !results.has(name)) {
        results.set(name, href);
      }
    }
  }

  // Also scan full HTML text (catches ATS URLs in JSON/script tags/data attributes)
  for (const { pattern, name } of ATS_PATTERNS) {
    if (!results.has(name) && pattern.test(html)) {
      // Try to extract a clean URL from the surrounding text
      const match = html.match(new RegExp(`https?://[^"' <>]*${pattern.source}[^"' <>]*`, "i"));
      results.set(name, match ? match[0] : null);
    }
  }

  return Array.from(results.entries()).map(([name, url]) => ({ name, url }));
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ATSDetector/1.0; +https://ats.burkeruder.ai)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    cf: { timeout: 10000 },
  });
  if (!res.ok) return null;
  const text = await res.text();
  return { html: text, finalUrl: res.url };
}

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  let domain = searchParams.get("domain") || "";

  if (!domain) {
    return Response.json({ error: "Missing domain parameter" }, { status: 400 });
  }

  // Normalize domain
  domain = domain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const base = `https://${domain}`;

  const checkedUrls = [];
  const allMatches = new Map();

  // Try homepage first, then career paths
  const urlsToCheck = [base, ...CAREER_PATHS.map((p) => base + p)];

  for (const url of urlsToCheck) {
    try {
      const result = await fetchPage(url);
      if (!result) continue;

      checkedUrls.push(url);
      const matches = detectATS(result.html, result.finalUrl);

      for (const match of matches) {
        if (!allMatches.has(match.name)) {
          allMatches.set(match.name, match.url);
        }
      }

      // If we found something on the careers page, stop early
      if (matches.length > 0 && url !== base) break;
    } catch {
      // skip unreachable paths
    }
  }

  const detected = Array.from(allMatches.entries()).map(([name, url]) => ({
    name,
    url,
  }));

  return Response.json({
    domain,
    detected,
    checkedUrls,
    found: detected.length > 0,
  });
}
