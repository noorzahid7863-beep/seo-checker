import fs from 'fs';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import { JSDOM } from 'jsdom';

// ----------------------------------------------------
// STEP 2: Read URLs (File or Sitemap) & Remove Duplicates (Set)
// ----------------------------------------------------
function getUrlsFromFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const rawUrls = data.split('\n').map(url => url.trim()).filter(Boolean);
    return Array.from(new Set(rawUrls));
  } catch (error) {
    console.error("Error reading file:", error.message);
    return [];
  }
}

async function getUrlsFromSitemap(sitemapUrl) {
  try {
    const response = await fetch(sitemapUrl);
    const xmlText = await response.text();
    const result = await parseStringPromise(xmlText);
    const urlObjects = result.urlset.url;
    const rawUrls = urlObjects.map(item => item.loc[0]);
    return Array.from(new Set(rawUrls));
  } catch (error) {
    console.error("Error fetching sitemap:", error.message);
    return [];
  }
}

// ----------------------------------------------------
// STEP 4: Analyze SEO (Title, Meta, H1, Images)
// ----------------------------------------------------
function analyzeSEO(html) {
  const issues = [];
  if (!html) return { issues: ["Failed to fetch page HTML"] };

  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Title
  const titleTag = document.querySelector('title');
  const titleText = titleTag ? titleTag.textContent.trim() : '';
  if (!titleText) issues.push("Title is missing");
  else if (titleText.length > 60) issues.push("Title is longer than 60 characters");

  // Meta Description
  const metaDesc = document.querySelector('meta[name="description"]');
  const metaContent = metaDesc ? metaDesc.getAttribute('content') : '';
  if (!metaContent) issues.push("Meta description is missing");
  else if (metaContent.length > 160) issues.push("Meta description is longer than 160 characters");

  // H1 Tag
  const h1Tags = document.querySelectorAll('h1');
  if (h1Tags.length === 0) issues.push("H1 tag is missing");
  else if (h1Tags.length > 1) issues.push("Multiple H1 tags found");

  // Images Alt
  const images = document.querySelectorAll('img');
  let missingAltCount = 0;
  images.forEach(img => {
    if (!img.getAttribute('alt')) missingAltCount++;
  });
  if (missingAltCount > 0) issues.push(`Images missing alt text (${missingAltCount})`);

  return { issues };
}

// ----------------------------------------------------
// STEP 3: Fetch Pages with Queue (Max 3 Concurrently)
// ----------------------------------------------------
async function fetchPage(url) {
  const startTime = Date.now();
  try {
    const response = await fetch(url, { timeout: 10000 });
    const duration = Date.now() - startTime;
    const html = await response.text();
    const seoData = analyzeSEO(html);

    return {
      url,
      status: response.status,
      responseTime: `${duration}ms`,
      issuesCount: seoData.issues.length,
      issues: seoData.issues
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      url,
      status: 0,
      responseTime: `${duration}ms`,
      issuesCount: 1,
      issues: ["Fetch error / Timeout"]
    };
  }
}

async function processQueue(urls, limit = 3) {
  const results = [];
  const executing = new Set();

  for (const url of urls) {
    const promise = fetchPage(url).then(result => {
      executing.delete(promise);
      return result;
    });

    results.push(promise);
    executing.add(promise);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// ----------------------------------------------------
// STEP 5: Generate Terminal Summary, JSON, and CSV Reports (Map)
// ----------------------------------------------------
function generateReports(results) {
  results.sort((a, b) => b.issuesCount - a.issuesCount);

  const issueGroupMap = new Map();
  let totalBrokenLinks = 0;

  results.forEach(res => {
    if (res.status === 404 || res.status === 500) totalBrokenLinks++;
    res.issues.forEach(issue => {
      const count = issueGroupMap.get(issue) || 0;
      issueGroupMap.set(issue, count + 1);
    });
  });

  console.log("\n================ SUMMARY REPORT ================");
  console.log(`Total Pages Checked : ${results.length}`);
  console.log(`Pages with Issues  : ${results.filter(r => r.issuesCount > 0).length}`);
  console.log(`Broken Links (404) : ${totalBrokenLinks}`);
  console.log("\n--- Issues Breakdown (Using Map) ---");
  issueGroupMap.forEach((count, issue) => {
    console.log(`${issue} → ${count} pages`);
  });
  console.log("================================================");

  // Save JSON
  const reportData = {
    summary: {
      totalPages: results.length,
      pagesWithIssues: results.filter(r => r.issuesCount > 0).length,
      brokenLinks: totalBrokenLinks,
      issueBreakdown: Object.fromEntries(issueGroupMap)
    },
    results
  };
  fs.writeFileSync('report.json', JSON.stringify(reportData, null, 2));

  // Save CSV
  let csvContent = "URL,Status,Response Time,Issues Count,Issues\n";
  results.forEach(r => {
    const issuesStr = `"${r.issues.join('; ')}"`;
    csvContent += `"${r.url}",${r.status},"${r.responseTime}",${r.issuesCount},${issuesStr}\n`;
  });
  fs.writeFileSync('report.csv', csvContent);

  console.log("\nSaved: 'report.json' and 'report.csv'");
}

// ----------------------------------------------------
// MAIN EXECUTION
// ----------------------------------------------------
async function main() {
  console.log("Starting SEO Audit...");
  const urls = getUrlsFromFile('urls.txt');
  
  if (urls.length === 0) {
    console.log("No URLs found in urls.txt!");
    return;
  }

  console.log(`Processing ${urls.length} URLs (Max 3 concurrently)...`);
  const results = await processQueue(urls, 3);
  generateReports(results);
}

main();