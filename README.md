# Website SEO & Link Health Checker

A Node.js automation tool that scans website pages, checks HTTP health, identifies SEO issues (missing titles, meta descriptions, missing H1s, alt text), and generates structured JSON and CSV reports.

## Features
- **URL Deduplication**: Removes duplicate links using JavaScript `Set`.
- **Concurrency Queue**: Limits parallel HTTP requests to 3 at a time.
- **SEO Inspection**: Validates Title, Meta Description, H1 tags, and Images `alt` attributes.
- **Reporting**: Exports summary and results to `report.json` and `report.csv` (using `Map` for issue grouping).
- **Interactive UI**: View report via HTML interface with search and filtering.

## How to Run

1. **Install Dependencies**:
   ```bash
   npm install