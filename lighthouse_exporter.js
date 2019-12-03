#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const url = require('url');
const puppeteer = require('puppeteer');
const lighthouse = require('lighthouse');
const minimist = require('minimist');
const gcs = require('./storage/gcs');
const Mutex = require('async-mutex').Mutex;

const port = process.env.PORT || 9593;
const browserWSEndpoint = process.env.WS_ENDPOINT;
const useGCS = Boolean(process.env.GCS);
const GCSBucket = process.env.GCS_BUCKET;
const configPath = process.env.CONFIG_PATH;
console.log(`use gcs is: ${useGCS}, use bucket is ${GCSBucket}`);
let config = {};
const mutex = new Mutex();
try {
  config = configPath ? JSON.parse(fs.readFileSync(configPath, { encoding: 'utf8' })) : {};
} catch (e) {
  console.error('Error while parsing extra headers');
}

http
  .createServer(async (req, res) => {
    const release = await mutex.acquire();
    if (req.aborted) {
      res.end();
      release();
      return;
    }

    const q = url.parse(req.url, true);
    let filesToUpload = [];

    if (q.pathname === '/probe') {
      const target = q.query.target;
      const htmlReport = process.env.HTML_REPORT;
      const strategies = ['mobile', 'desktop'];
      const data = [];

      try {
        console.log('connecting to browser...');
        const browser = browserWSEndpoint ? await puppeteer.connect({ browserWSEndpoint }) : await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        console.log('connected browser successfuly...');
        data.push('# HELP lighthouse_exporter_info Exporter Info');
        data.push('# TYPE lighthouse_exporter_info gauge');
        data.push(`lighthouse_exporter_info{version="0.2.4",chrome_version="${await browser.version()}",node_version="${process.version}"} 1`);
        for (const strategy of strategies) {
          console.log(`Starting ${strategy} audit on ${target}`);
          await lighthouse(target, {
            port: url.parse(browser.wsEndpoint()).port,
            output: htmlReport ? 'html' : 'json',
            emulatedFormFactor: strategy,
            throttlingMethod: 'provided',
            ...config,
          })
            .then(async results => {
              console.log(`Finished auditing ${strategy}`);

              data.push('# HELP lighthouse_score The Score per Category');
              data.push('# TYPE lighthouse_score gauge');

              for (var category in results.lhr.categories) {
                var item = results.lhr.categories[category];

                data.push(`lighthouse_score{category="${category}", strategy="${strategy}"} ${item.score * 100}`);
              }

              const audits = results.lhr.audits;

              data.push('# HELP lighthouse_timings Audit timings in ms');
              data.push('# TYPE lighthouse_timings gauge');

              data.push(`lighthouse_timings{audit="first-contentful-paint", strategy="${strategy}"} ${Math.round(audits['first-contentful-paint'].numericValue)}`);
              data.push(`lighthouse_timings{audit="first-meaningful-paint", strategy="${strategy}"} ${Math.round(audits['first-meaningful-paint'].numericValue)}`);
              data.push(`lighthouse_timings{audit="speed-index", strategy="${strategy}"} ${Math.round(audits['speed-index'].numericValue)}`);
              data.push(`lighthouse_timings{audit="first-cpu-idle", strategy="${strategy}"} ${Math.round(audits['first-cpu-idle'].numericValue)}`);
              data.push(`lighthouse_timings{audit="interactive", strategy="${strategy}"} ${Math.round(audits['interactive'].numericValue)}`);
              data.push(`lighthouse_timings{audit="estimated-input-latency", strategy="${strategy}"} ${Math.round(audits['estimated-input-latency'].numericValue)}`);

              if (htmlReport) {
                const now = new Date();
                const fileName = `${now.toISOString()}.html`;
                if (useGCS && GCSBucket) {
                  filesToUpload.push({
                    path: `performance_audit/reports/${now.getFullYear()}_${now.getMonth()}_${now.getUTCDate()}/${encodeURIComponent(target)}/${strategy}/${fileName}`,
                    data: results.report,
                  });
                } else {
                  fs.writeFile(fileName, results.report, () => {});
                }
              }
            })
            .catch(error => {
              console.error('Lighthouse', Date(), error);
            });
        }
        browser.close();

        console.log(`finished auditing ${target} succesfully`);
      } catch (error) {
        console.error('Generic', Date(), error);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write(data.join('\n'));
      res.end();
    } else {
      res.writeHead(404);
    }

    console.log(`Start uploading result to GCS`);
    try {
      filesToUpload.forEach(d => gcs.uploadFile(d.data, d.path, GCSBucket));
    } catch (e) {
      console.log('Failed uploading to GCS');
    }
    filesToUpload = [];
    console.log(`Finished process`);

    release();
  })
  .listen(port);
