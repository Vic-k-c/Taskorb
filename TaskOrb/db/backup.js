require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const pool = require('./pool');

// Logical JSON export of every table (not a binary pg_dump -- keeps this
// dependency-free and portable, since pg_dump's client binary isn't
// guaranteed to be present in Render's Node build image).
//
// IMPORTANT: writing to local disk alone does NOT protect you on Render --
// the filesystem is wiped on every restart/redeploy, same issue as file
// attachments. This script writes locally always (useful for local dev, or
// as a staging area), and ALSO uploads to S3-compatible storage if the
// S3_* env vars below are set. Until those are set, this is not a real
// backup -- just a local dump that disappears with the container.

const TABLES = [
  'organizations', 'users', 'org_members',
  'boards', 'board_members', 'lists', 'cards', 'card_attachments',
  'notifications', 'schema_migrations'
];

async function dumpDatabase() {
  const dump = { taken_at: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    dump.tables[table] = rows;
  }
  return dump;
}

// Minimal AWS SigV4 PUT, written by hand to avoid pulling in the full
// aws-sdk just for one PUT request. Works with any S3-compatible endpoint
// (AWS S3, Cloudflare R2, Backblaze B2's S3-compatible API, etc).
function sign(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

async function uploadToS3(filename, body) {
  const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT } = process.env;
  if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    console.log('S3 credentials not configured -- skipping upload (backup stays local only).');
    return false;
  }

  const region = S3_REGION || 'us-east-1';
  const host = S3_ENDPOINT || `${S3_BUCKET}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n/${filename}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  const kDate = sign(`AWS4${S3_SECRET_KEY}`, dateStamp);
  const kRegion = sign(kDate, region);
  const kService = sign(kRegion, 's3');
  const kSigning = sign(kService, 'aws4_request');
  const signature = sign(kSigning, stringToSign).toString('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: `/${filename}`,
      method: 'PUT',
      headers: {
        'Content-Length': body.length,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        'Authorization': authHeader
      }
    }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`Uploaded to s3://${S3_BUCKET}/${filename}`);
        resolve(true);
      } else {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => reject(new Error(`S3 upload failed (${res.statusCode}): ${body}`)));
      }
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Dumping database...');
  const dump = await dumpDatabase();
  const json = JSON.stringify(dump, null, 2);

  const filename = `taskorb-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const localDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(localDir, { recursive: true });
  const localPath = path.join(localDir, filename);
  fs.writeFileSync(localPath, json);
  console.log(`Wrote local backup: ${localPath} (${(json.length / 1024).toFixed(0)} KB)`);

  try {
    await uploadToS3(filename, Buffer.from(json));
  } catch (err) {
    console.error('S3 upload failed:', err.message);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
