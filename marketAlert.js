import yahooFinance from "yahoo-finance2";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const THRESHOLD = 0.3; // Only negative movement applies

// Scheme Codes
const nifty50SchemeCodes = [
  "151165", "151471", "119648", "153529", "149373",
  "153506", "118482", "152329", "146376", "149250",
  "118581", "153704", "119063", "151157", "120620",
  "153787", "148978", "120307", "152972", "147794",
  "149039", "119288", "118881", "120717", "153906"
];

const niftyNext50SchemeCodes = [
  "149838","149466","153479","153350","146381",
  "150899","153786","149288","151160","120684",
  "153789","148745","151937","147796","149447",
  "148945","153858","143341",
];

// Email Setup
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO || EMAIL_USER;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

// Fetch MF NAV Data
async function fetchFundDetails(code) {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${code}`);
    const data = await res.json();

    const fName = data?.meta?.scheme_name;
    const latest = data?.data?.[0];
    const prev = data?.data?.[1];

    const nav = latest ? Number(latest.nav) : null;
    const prevNav = prev ? Number(prev.nav) : null;

    const changePercent =
      nav && prevNav ? ((nav - prevNav) / prevNav) * 100 : null;

    const category = fName.toLowerCase().includes("next 50")
      ? "NIFTYNEXT50"
      : "NIFTY50";

    return {
      code,
      name: fName,
      nav,
      navDate: latest?.date || "",
      previousNav: prevNav,
      previousDate: prev?.date || "",
      changePercent,
      category,
    };
  } catch {
    return null;
  }
}

function formatINR(val) {
  return val ? `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—";
}

// Get Index Change %
async function checkIndex(label, ticker) {
  const yt = new yahooFinance();
  const data = await yt.quote(ticker);
  return {
    label,
    change: Number(data.regularMarketChangePercent),
  };
}

async function sendMail(subject, html) {
  await transporter.sendMail({
    from: EMAIL_USER,
    to: EMAIL_USER,
    bcc: EMAIL_TO,
    subject,
    html,
  });
  console.log("📩 Email Sent!");
}

async function main() {
  console.log("📊 Checking Nifty indices...");

  const [nifty50, niftyNext50] = await Promise.all([
    checkIndex("Nifty 50", "^NSEI"),
    checkIndex("Nifty Next 50", "^NSMIDCP"),
  ]);

  const nifty50Triggered = nifty50.change <= -THRESHOLD;
  const niftyNext50Triggered = niftyNext50.change <= -THRESHOLD;

  let include50Funds = false;
  let includeNextFunds = false;

  if (nifty50Triggered && niftyNext50Triggered) {
    include50Funds = true;
    includeNextFunds = true;
  } else if (nifty50Triggered) {
    include50Funds = true;
  } else if (niftyNext50Triggered) {
    includeNextFunds = true;
  }

  let html = `
  <div style="font-family:Arial;padding:12px;">
  <h2 style="text-align:center;color:#d32f2f;">📉 Market Update</h2>
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr style="background:#eee;">
        <th style="border:1px solid #ccc;padding:8px;">Index</th>
        <th style="border:1px solid #ccc;padding:8px;">Change (%)</th>
      </tr>
    </thead>
    <tbody>
      ${[nifty50, niftyNext50].map(x => `
      <tr>
        <td style="border:1px solid #ccc;padding:8px;"><b>${x.label}</b></td>
        <td style="border:1px solid #ccc;padding:8px;color:${x.change < 0 ? "red" : "green"};">
          ${x.change.toFixed(2)}%
        </td>
      </tr>`).join("")}
    </tbody>
  </table>`;

  async function loadFunds(codes, title) {
    const funds = (await Promise.all(codes.map(fetchFundDetails))).filter(Boolean);

    // Sorting: biggest dip first
    funds.sort((a, b) => {
      const A = a.changePercent ?? 0;
      const B = b.changePercent ?? 0;
      return B - A;
    });

    html += `
    <h3 style="color:#0d47a1;margin-top:18px;">${title} - Fund Performance</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#0d47a1;color:white;text-align:center;">
          <th style="padding:10px;border:1px solid #ccc;text-align:left;">Fund Name</th>
          <th style="padding:10px;border:1px solid #ccc;">
            Prev NAV<br/>
          </th>
          <th style="padding:10px;border:1px solid #ccc;">
            Latest NAV<br/>
          </th>
          <th style="padding:10px;border:1px solid #ccc;">Change %</th>
        </tr>
      </thead>
      <tbody>
        ${funds.map(f => `
        <tr>
          <td style="padding:10px;border:1px solid #ccc;text-align:left;">${f.name}</td>
          <td style="padding:10px;border:1px solid #ccc;">
            ${formatINR(f.previousNav)}<br/><small>${f.previousDate}</small>
          </td>
          <td style="padding:10px;border:1px solid #ccc;">
            ${formatINR(f.nav)}<br/><small>${f.navDate}</small>
          </td>
          <td style="padding:10px;border:1px solid #ccc;font-weight:bold;color:${f.changePercent < 0 ? "#c62828" : "#2e7d32"};">
            ${f.changePercent?.toFixed(2) ?? "—"}%
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  }

  if (include50Funds) await loadFunds(nifty50SchemeCodes, "NIFTY 50");
  if (includeNextFunds) await loadFunds(niftyNext50SchemeCodes, "NIFTY NEXT 50");

  if (!include50Funds && !includeNextFunds) {
    html += `<p style="margin-top:10px;">📌 Today no index dropped below threshold.</p>`;
  }

  html += `<p style="margin-top:15px;font-size:12px;text-align:center;color:gray;">*This is not investment advice*</p></div>`;

  await sendMail("📉 Market Update", html);
}

main().catch(console.error);
