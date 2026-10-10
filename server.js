import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.json());
app.use(express.static(__dirname));

// Express route for dynamic input box audit
app.post('/api/audit', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  console.log(`Express trigger: Running audit for ${url}`);
  exec(`node index.js ${url}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Exec error: ${error}`);
      return res.status(500).json({ error: 'Failed to run audit' });
    }
    
    // Read generated report.json
    try {
      const reportData = fs.readFileSync(path.join(__dirname, 'report.json'), 'utf8');
      res.json(JSON.parse(reportData));
    } catch (e) {
      res.status(500).json({ error: 'Could not read generated report' });
    }
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Audit Express Server running at http://localhost:${PORT}`);
});