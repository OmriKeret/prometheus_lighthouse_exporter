#!/usr/bin/env node

'use strict';

const fs = require('fs');
const http = require('http');
const url = require('url');
const puppeteer = require('puppeteer');
const lighthouse = require('lighthouse');
const minimist = require('minimist');
const gcs = require('./storage/gcs');
var Mutex = require('async-mutex').Mutex;

var argv = minimist(process.argv.slice(2));

var port = process.env.PORT || 9593;
var browserWSEndpoint = process.env.WS_ENDPOINT;
var useGCS = Boolean(process.env.GCS);
var GCSBucket = process.env.GCS_BUCKET;

console.log(`use gcs is: ${useGCS}, use bucket is ${GCSBucket}`);
if('p' in argv){
    port = argv.p;
}

const mutex = new Mutex();

http.createServer(async (req, res) => {
    const release = await mutex.acquire();

    var q = url.parse(req.url, true);

    if(q.pathname == '/probe'){
        var target = q.query.target;
        var htmlReport = q.query.htmlReport;
        var configUnparsed = q.query.config;
        var strategies = Array.isArray(q.query.strategies) ? q.query.strategies : ['mobile'] ;
        var data = [];

        
        try{
            var config = configUnparsed ? JSON.parse(configUnparsed) : {};
            console.log('connecting to browser...');
            const browser = browserWSEndpoint ? await puppeteer.connect({browserWSEndpoint}) : await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
            console.log('connected browser successfuly...');
            data.push('# HELP lighthouse_exporter_info Exporter Info');
            data.push('# TYPE lighthouse_exporter_info gauge');
            data.push(`lighthouse_exporter_info{version="0.2.4",chrome_version="${await browser.version()}",node_version="${process.version}"} 1`);
            for (const index in strategies) {
                const strategy = strategies[index];
                console.log(`Starting lighthouse on target`)
                await lighthouse(target, {
                    port: url.parse(browser.wsEndpoint()).port,
                    output: htmlReport ? 'html' : 'json',
                    emulatedFormFactor: strategy,
                    ...config
                 })
                    .then(async results => {
                        console.log(`Finished auditing ${strategy}`);

                        data.push('# HELP lighthouse_score The Score per Category');
                        data.push('# TYPE lighthouse_score gauge');
    
                        for(var category in results.lhr.categories){
                            var item = results.lhr.categories[category];
    
                            data.push(`lighthouse_score{category="${category}", strategy="${strategy}"} ${item.score * 100}`);
                        }
    
                        var audits = results.lhr.audits;
    
                        data.push('# HELP lighthouse_timings Audit timings in ms');
                        data.push('# TYPE lighthouse_timings gauge');
    
                        data.push(`lighthouse_timings{audit="first-contentful-paint", strategy="${strategy}"} ${Math.round(audits["first-contentful-paint"].numericValue)}`);
                        data.push(`lighthouse_timings{audit="first-meaningful-paint", strategy="${strategy}"} ${Math.round(audits["first-meaningful-paint"].numericValue)}`);
                        data.push(`lighthouse_timings{audit="speed-index", strategy="${strategy}"} ${Math.round(audits["speed-index"].numericValue)}`);
                        data.push(`lighthouse_timings{audit="first-cpu-idle", strategy="${strategy}"} ${Math.round(audits["first-cpu-idle"].numericValue)}`);
                        data.push(`lighthouse_timings{audit="interactive", strategy="${strategy}"} ${Math.round(audits["interactive"].numericValue)}`);
                        data.push(`lighthouse_timings{audit="estimated-input-latency", strategy="${strategy}"} ${Math.round(audits["estimated-input-latency"].numericValue)}`);
                        
                        if (htmlReport) {
                            console.log(`Start uploading result to GCS`);
                            const now = new Date();
                            const fileName = `${now.toISOString()}.html`;
                            if (useGCS && GCSBucket) {
                                await gcs.uploadFile(results.report, `/performance_audit/reports/${now.getFullYear()}_${now.getMonth()}_${now.getUTCDate()}}/${target}/${strategy}/${fileName}`, GCSBucket);
                            } else {
                                fs.writeFile(fileName, results.report, () => {});
                            }
                        }
                    })
                    .catch(error => {
                        console.error("Lighthouse", Date(), error);
                    });
            
            }

        console.log('finished auditing succesfully');
        await browser.close();
        } catch(error) {
            console.error("Generic", Date(), error);
        }

        res.writeHead(200, {"Content-Type": "text/plain"});
        res.write(data.join("\n"));
    } else{
        res.writeHead(404);
    }

    release();

    res.end();
}).listen(port);
