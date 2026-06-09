/***********************
 * NSE + MUTUAL FUND ALERT
 * Node.js (ESM)
 ***********************/

import fetch from "node-fetch";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

/* =======================
   ENV VALIDATION
======================= */

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }
}

try {
  requireEnv("EMAIL_USER");
  requireEnv("EMAIL_PASS");
  requireEnv("EMAIL_TO");

  console.log("✅ Environment variables loaded successfully");
} catch (err) {
  console.error(err.message);
  process.exit(1); // HARD FAIL (important for GitHub cron)
}

/* =======================
   CONFIG
======================= */

// MF Scheme Codes
const nifty50SchemeCodes = [
  "151165","151471","119648","153529","149373",
  "153506","118482","152329","146376","149250",
  "118581","153704","119063","151157","120620",
  "153787","148978","120307","152972","147794",
  "149039","119288","118881","120717","153906"
];

const niftyNext50SchemeCodes = [
  "149838","149466","153479","153350","146381",
  "150899","153786","149288","151160","120684",
  "153789","148745","151937","147796","149447",
  "148945","153858","143341","145137"
];

/* =======================
   NSE INDEX FETCH
======================= */

async function fetchNSEIndex(indexName) {
  try {
    const url = `https://www.nseindia.com/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://www.nseindia.com/"
      }
    });

    if (!res.ok) {
      throw new Error(`NSE API failed (${res.status})`);
    }

    const json = await res.json();
    const data = json?.data?.[0];

    if (!data) {
      throw new Error("NSE response missing data");
    }

    return {
      name: json.name,
      lastPrice: data.lastPrice,
      pChange: data.pChange,
      timestamp: json.timestamp
    };
  } catch (err) {
    console.error(`⚠️ NSE fetch failed for ${indexName}:`, err.message);

    return {
      name: indexName,
      lastPrice: "—",
      pChange: 0,
      timestamp: "N/A"
    };
  }
}

/* =======================
   MUTUAL FUND NAV FETCH
======================= */

async function fetchFundDetails(code) {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${code}`);

    if (!res.ok) {
      throw new Error(`MF API error (${res.status})`);
    }

    const data = await res.json();

    if (!data?.data?.length) {
      throw new Error("No NAV data found");
    }

    const latest = data.data[0];
    const prev = data.data[1];

    const nav = Number(latest.nav);
    const prevNav = prev ? Number(prev.nav) : null;

    return {
      name: data.meta.scheme_name,
      nav,
      navDate: latest.date,
      previousNav: prevNav,
      previousDate: prev?.date,
      changePercent:
        nav && prevNav ? ((nav - prevNav) / prevNav) * 100 : null
    };
  } catch (err) {
    console.error(`⚠️ MF fetch failed for scheme ${code}:`, err.message);
    return null;
  }
}

/* =======================
   EMAIL SETUP
======================= */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendMail(subject, html) {
  try {
    console.log("🔐 Verifying SMTP credentials...");
    await transporter.verify();
    console.log("✅ SMTP verified");

    console.log("📤 Sending email...");
    const info = await transporter.sendMail({
      from: `"Market Alert" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO,
      subject,
      html
    });

    console.log("📩 Email sent successfully:", info.messageId);
  } catch (err) {
    console.error("❌ EMAIL ERROR");
    console.error("Code:", err.code);
    console.error("Response:", err.response);
    console.error("Message:", err.message);

    throw new Error("Email sending failed");
  }
}

/* =======================
   HELPERS
======================= */

function formatINR(val) {
  return val
    ? `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
    : "—";
}

/* =======================
   MAIN
======================= */

async function main() {
  console.log("📊 Fetching market data...");

  const nifty50 = await fetchNSEIndex("NIFTY 50");
  const niftyNext50 = await fetchNSEIndex("NIFTY NEXT 50");

  let html = `
  <div style="font-family:Arial;padding:12px;">
    <h2 style="text-align:center;">📈 Market & Mutual Fund Update</h2>

    <table style="width:100%;border-collapse:collapse;">
      <tr style="background:#eee;">
        <th style="border:1px solid #ccc;padding:8px;">Index</th>
        <th style="border:1px solid #ccc;padding:8px;">Change %</th>
        <th style="border:1px solid #ccc;padding:8px;">Last Price</th>
      </tr>
      <tr>
        <td style="border:1px solid #ccc;padding:8px;">NIFTY 50</td>
        <td style="border:1px solid #ccc;padding:8px;color:${nifty50.pChange < 0 ? "red" : "green"};">
          ${nifty50.pChange}%
        </td>
        <td style="border:1px solid #ccc;padding:8px;">${nifty50.lastPrice}</td>
      </tr>
      <tr>
        <td style="border:1px solid #ccc;padding:8px;">NIFTY NEXT 50</td>
        <td style="border:1px solid #ccc;padding:8px;color:${niftyNext50.pChange < 0 ? "red" : "green"};">
          ${niftyNext50.pChange}%
        </td>
        <td style="border:1px solid #ccc;padding:8px;">${niftyNext50.lastPrice}</td>
      </tr>
    </table>
  `;

  async function loadFunds(codes, title) {
    const funds = (await Promise.all(codes.map(fetchFundDetails)))
      .filter(Boolean)
      .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));

    html += `
    <h3 style="margin-top:18px;">${title}</h3>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="background:#0d47a1;color:white;">
        <th style="padding:8px;border:1px solid #ccc;text-align:left;">Fund</th>
        <th style="padding:8px;border:1px solid #ccc;">Prev NAV</th>
        <th style="padding:8px;border:1px solid #ccc;">Latest NAV</th>
        <th style="padding:8px;border:1px solid #ccc;">Change %</th>
      </tr>
      ${funds.map(f => `
      <tr>
        <td style="padding:8px;border:1px solid #ccc;">${f.name}</td>
        <td style="padding:8px;border:1px solid #ccc;">
          ${formatINR(f.previousNav)}<br/><small>${f.previousDate}</small>
        </td>
        <td style="padding:8px;border:1px solid #ccc;">
          ${formatINR(f.nav)}<br/><small>${f.navDate}</small>
        </td>
        <td style="padding:8px;border:1px solid #ccc;
          color:${f.changePercent < 0 ? "red" : "green"};
          font-weight:bold;">
          ${f.changePercent?.toFixed(2)}%
        </td>
      </tr>`).join("")}
    </table>`;
  }

  await loadFunds(nifty50SchemeCodes, "NIFTY 50 MUTUAL FUNDS");
  await loadFunds(niftyNext50SchemeCodes, "NIFTY NEXT 50 MUTUAL FUNDS");

  html += `
    <p style="margin-top:15px;font-size:12px;color:gray;text-align:center;">
      Data Source: NSE India & MFAPI | Not investment advice
    </p>
  </div>`;

  await sendMail("📈 Daily Mutual Fund Update", html);
}

/* =======================
   RUN
======================= */

(async () => {
  try {
    await main();
    console.log("✅ Job completed successfully");
  } catch (err) {
    console.error("❌ JOB FAILED");
    console.error(err.message);
    process.exit(1);
  }
})();
