import fs from 'fs';
import fetch from 'node-fetch';
import { URL } from 'url';

// 1. Get Target URL from Command Line (e.g. node index.js https://www.xloopdigital.com)
const inputUrl = process.argv[2] || 'https://www.xloopdigital.com';
const baseUrl = new URL(inputUrl).origin;

console.log(`🚀 Starting Crawl & Audit for: ${baseUrl}`);

const visitedUrls = new Set();
const pagesToCrawl = [];
const auditResults = [];
const issueSummaryMap = new Map();
const MAX_PAGES = 50;

function trackIssue(type) {
  issueSummaryMap.set(type, (issueSummaryMap.get(type) || 0) + 1);
}

// 2. Fetch Sitemap or Fallback to Internal Links
async function getUrlsToCrawl() {
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  try {
    const res = await fetch(sitemapUrl, { timeout: 5000 });
    if (res.status === 200) {
      const text = await res.text();
      const locs = text.match(/<loc>(.*?)<\/loc>/gi) || [];
      const extracted = locs.map(l => l.replace(/<\/?loc>/g, '')).filter(u => u.startsWith(baseUrl));
      if (extracted.length > 0) {
        console.log(`✅ Found ${extracted.length} URLs in sitemap.xml`);
        return Array.from(new Set(extracted)).slice(0, MAX_PAGES);
      }
    }
  } catch (err) {
    console.log(`⚠️ Sitemap fetch failed or not found. Falling back to internal crawling.`);
  }
  return [baseUrl];
}

// Helper to check broken internal links inside a page
async function checkInternalLinks(html, currentPageUrl) {
  const linkMatches = html.match(/href=["'](\/?[^"']+)["']/gi) || [];
  const brokenLinks = [];
  const checkedLinks = new Set();

  for (let match of linkMatches) {
    let href = match.replace(/href=["']/i, '').replace(/["']$/, '');
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    
    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, currentPageUrl).href;
    } catch (e) {
      continue;
    }

    if (!absoluteUrl.startsWith(baseUrl) || checkedLinks.has(absoluteUrl)) continue;
    checkedLinks.add(absoluteUrl);

    // Collect new pages for crawler if needed
    if (!visitedUrls.has(absoluteUrl) && pagesToCrawl.length < MAX_PAGES && !pagesToCrawl.includes(absoluteUrl)) {
      pagesToCrawl.push(absoluteUrl);
    }

    // Check link status
    try {
      const linkRes = await fetch(absoluteUrl, { method: 'HEAD', timeout: 3000 });
      if (linkRes.status === 404) {
        brokenLinks.push(absoluteUrl);
        trackIssue("Broken Internal Link (404)");
      }
    } catch (err) {
      // Ignore timeout or fetch errors for sub-links
    }
  }
  return brokenLinks;
}

// 3. Page SEO Validator
async function auditPage(pageUrl) {
  const startTime = Date.now();
  const issues = [];
  let brokenLinks = [];

  try {
    const res = await fetch(pageUrl, { timeout: 8000 });
    const responseTime = `${Date.now() - startTime}ms`;
    const statusCode = res.status;

    if (statusCode === 404) {
      issues.push("Page Not Found (404)");
      trackIssue("Page 404");
    }

    const html = await res.text();

    // SEO Checks
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    if (!titleMatch) {
      issues.push("Missing Title Tag");
      trackIssue("Missing Title Tag");
    } else if (titleMatch[1].length > 60) {
      issues.push(`Title too long (${titleMatch[1].length} chars)`);
      trackIssue("Title Too Long (>60 chars)");
    }

    const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);
    if (!metaMatch) {
      issues.push("Missing Meta Description");
      trackIssue("Missing Meta Description");
    } else if (metaMatch[1].length > 160) {
      issues.push(`Meta description too long (${metaMatch[1].length} chars)`);
      trackIssue("Meta Description Too Long (>160 chars)");
    }

    const h1Matches = html.match(/<h1[\s>]/gi) || [];
    if (h1Matches.length === 0) {
      issues.push("Missing H1 Tag");
      trackIssue("Missing H1 Tag");
    } else if (h1Matches.length > 1) {
      issues.push(`Multiple H1 Tags (${h1Matches.length})`);
      trackIssue("Multiple H1 Tags");
    }

    const imgMatches = html.match(/<img[^>]+>/gi) || [];
    let missingAlt = 0;
    imgMatches.forEach(img => {
      if (!img.includes('alt=') || img.includes('alt=""')) missingAlt++;
    });
    if (missingAlt > 0) {
      issues.push(`${missingAlt} image(s) missing alt text`);
      trackIssue("Missing Image Alt Text");
    }

    // Check broken internal links on this page
    brokenLinks = await checkInternalLinks(html, pageUrl);
    if (brokenLinks.length > 0) {
      issues.push(`${brokenLinks.length} broken internal link(s) found`);
    }

    return {
      url: pageUrl,
      status: statusCode,
      responseTime,
      issuesCount: issues.length,
      issues,
      brokenLinksDetails: brokenLinks
    };

  } catch (err) {
    return {
      url: pageUrl,
      status: 'Error / Timeout',
      responseTime: 'N/A',
      issuesCount: 1,
      issues: ['Failed to fetch page'],
      brokenLinksDetails: []
    };
  }
}

// 4. Main Crawl Execution
async function runFullAudit() {
  const initialUrls = await getUrlsToCrawl();
  pagesToCrawl.push(...initialUrls);

  while (pagesToCrawl.length > 0 && visitedUrls.size < MAX_PAGES) {
    const currentUrl = pagesToCrawl.shift();
    if (visitedUrls.has(currentUrl)) continue;
    visitedUrls.add(currentUrl);

    console.log(`[${visitedUrls.size}/${MAX_PAGES}] Scanning: ${currentUrl}`);
    const result = await auditPage(currentUrl);
    auditResults.push(result);
  }

  // Sort Worst-First (Most issues first)
  auditResults.sort((a, b) => b.issuesCount - a.issuesCount);

  // Top 5 Worst Pages
  const top5WorstPages = auditResults.slice(0, 5).map(p => ({
    url: p.url,
    issuesCount: p.issuesCount,
    issues: p.issues
  }));

  let totalBrokenLinks = 0;
  auditResults.forEach(r => totalBrokenLinks += (r.brokenLinksDetails ? r.brokenLinksDetails.length : 0));

  const finalReport = {
    targetWebsite: baseUrl,
    scannedAt: new Date().toISOString(),
    summary: {
      totalPagesScanned: auditResults.length,
      pagesWithIssues: auditResults.filter(p => p.issuesCount > 0).length,
      totalBrokenLinks: totalBrokenLinks,
      top5WorstPages: top5WorstPages,
      issueSummary: Object.fromEntries(issueSummaryMap)
    },
    issueImportanceGuide: {
      highPriority: "Broken Links (404) & Missing Title: Direct impact on Google rankings and user bounce rate.",
      mediumPriority: "Meta Description & H1 Tags: Affects CTR on Google search results and page structure.",
      lowPriority: "Missing Image Alt Text: Affects accessibility and Google Image search ranking."
    },
    pages: auditResults
  };

  // Generate Files
  fs.writeFileSync('report.json', JSON.stringify(finalReport, null, 2));

  // CSV Generation
  let csvContent = 'URL,Status,Response Time,Issues Count,Issues,Broken Links\n';
  auditResults.forEach(row => {
    const issuesStr = `"${row.issues.join('; ')}"`;
    const brokenStr = `"${(row.brokenLinksDetails || []).join('; ')}"`;
    csvContent += `"${row.url}",${row.status},"${row.responseTime}",${row.issuesCount},${issuesStr},${brokenStr}\n`;
  });
  fs.writeFileSync('report.csv', csvContent);

  console.log('\n✅ Audit Finished!');
  console.log(`📊 Summary: ${finalReport.summary.totalPagesScanned} pages scanned, ${finalReport.summary.totalBrokenLinks} broken links found.`);
  console.log('📁 Saved to report.json and report.csv\n');
}

runFullAudit();