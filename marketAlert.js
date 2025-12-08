import yahooFinance from "yahoo-finance2";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const THRESHOLD = 0.30; // % change — modify anytime

// Scheme codes (you will expand)
const nifty50SchemeCodes = ["151165", "151471", "119648", "153529", "149373",
  "153506", "118482", "152329", "146376", "149250",
  "118581", "153704", "119063", "151157", "120620",
  "153787", "148978", "120307", "152972", "147794",
  "149039", "119288", "118881", "120717", "153906"];
const niftyNext50SchemeCodes = ["149838"];

// Email settings
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO || EMAIL_USER;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

// Fetch mutual fund NAV data
async function fetchFundDetails(code) {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${code}`);
    if (!res.ok) throw new Error(`Failed to fetch fund data ${code}`);
    const data = await res.json();

    const fundName = data?.meta?.scheme_name || "Unknown Fund";
    const latest = data?.data?.[0];
    const previous = data?.data?.[1];

    const nav = latest ? Number(latest.nav) : null;
    const previousNav = previous ? Number(previous.nav) : null;

    let changePercent = null;
    if (nav && previousNav) {
      changePercent = ((nav - previousNav) / previousNav) * 100;
    }

    const lowerName = fundName.toLowerCase();

    const category = lowerName.includes("nifty next 50") || lowerName.includes("next 50")
      ? "NIFTYNEXT50"
      : lowerName.includes("nifty 50")
        ? "NIFTY50"
        : "OTHER";

    return {
      code,
      name: fundName,
      nav,
      navDate: latest?.date || "",
      previousNav,
      previousDate: previous?.date || "",
      changePercent,
      category,
    };
  } catch (err) {
    console.error(err);
    return null;
  }
}

function formatINR(value) {
  if (!value) return "—";
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
  })}`;
}

// Fetch index % change
async function checkIndex(label, ticker, category) {
  const yt = new yahooFinance();
  const result = await yt.quote(ticker);
  return {
    label,
    change: Number(result.regularMarketChangePercent),
    close: result.regularMarketPrice,
    category,
  };
}

// Email sender
async function sendMail(subject, html, text) {
  await transporter.sendMail({
    from: EMAIL_USER,
    to: EMAIL_USER,
    bcc: EMAIL_TO,
    subject,
    text,
    html,
  });
  console.log("📩 Email Sent Successfully!");
}

// Main function
async function main() {
  console.log("🚀 Checking Market Indices...");

  // Fetch index data
  const [nifty50, niftyNext50] = await Promise.all([
    checkIndex("Nifty 50", "^NSEI", "NIFTY50"),
    checkIndex("Nifty Next 50", "^NSMIDCP", "NIFTYNEXT50"),
  ]);

  const nifty50Triggered = Math.abs(nifty50.change) >= THRESHOLD;
  const niftyNext50Triggered = Math.abs(niftyNext50.change) >= THRESHOLD;

  // Always prepare index change report
  let indexHtml = `
  <h2 style="color:#D32F2F;">📈 Market Index Updates</h2>
  <table style="width:100%; border-collapse: collapse;">
    <thead>
      <tr style="background:#eee;">
        <th style="border:1px solid #ccc; padding:8px;">Index</th>
        <th style="border:1px solid #ccc; padding:8px;">Change (%)</th>
      </tr>
    </thead>
    <tbody>`;
  let indexText = "Market Index Changes:\n";

  const appendIndexRow = (idx) => {
    indexHtml += `
      <tr>
        <td style="border:1px solid #ccc; padding:8px;"><b>${idx.label}</b></td>
        <td style="border:1px solid #ccc; padding:8px; color:${idx.change < 0 ? "red" : "green"};">
          ${idx.change.toFixed(2)}%
        </td>
      </tr>`;
    indexText += `${idx.label}: ${idx.change.toFixed(2)}%\n`;
  };

  appendIndexRow(nifty50);
  appendIndexRow(niftyNext50);
  indexHtml += "</tbody></table>";

  // If no index crosses threshold, send email with index info only
  if (!nifty50Triggered && !niftyNext50Triggered) {
    console.log("No index movement beyond threshold today. Sending index update email...");
    await sendMail(
      "Market Index Update",
      indexHtml,
      indexText
    );
    return; // Exit after sending index update
  }

  // Proceed with fetching fund data only if threshold is crossed
  const nifty50Funds = nifty50Triggered
    ? await Promise.all(nifty50SchemeCodes.map(fetchFundDetails))
    : [];
  const niftyNext50Funds = niftyNext50Triggered
    ? await Promise.all(niftyNext50SchemeCodes.map(fetchFundDetails))
    : [];

  // Build the detailed alert email
  let html = indexHtml; // Start with index info
  let text = indexText;

  // Helper function to generate fund tables
  const generateFundTable = (funds, categoryLabel) => {
    const validFunds = funds.filter(Boolean);
    if (validFunds.length === 0) return "";
    return `
    <h3 style="margin-top:20px;">${categoryLabel} Funds</h3>
    <table style="width:100%; border-collapse: collapse;">
      <thead>
        <tr style="background:#004B92; color:white;">
          <th style="padding:8px; border:1px solid #ccc;">Fund</th>
          <th style="padding:8px; border:1px solid #ccc;">Prev NAV</th>
          <th style="padding:8px; border:1px solid #ccc;">Latest NAV</th>
          <th style="padding:8px; border:1px solid #ccc;">Change %</th>
        </tr>
      </thead>
      <tbody>
        ${validFunds.map(f => `
          <tr>
            <td style="padding:8px; border:1px solid #ccc; text-align:left;">${f.name}</td>
            <td style="padding:8px; border:1px solid #ccc;">${formatINR(f.previousNav)}</td>
            <td style="padding:8px; border:1px solid #ccc;">${formatINR(f.nav)}</td>
            <td style="padding:8px; border:1px solid #ccc; font-weight:bold;
              color:${f.changePercent < 0 ? "red" : "green"};">
              ${f.changePercent ? f.changePercent.toFixed(2) + "%" : "—"}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  };

  if (nifty50Triggered) {
    html += generateFundTable(nifty50Funds, "NIFTY 50");
  }

  if (niftyNext50Triggered) {
    html += generateFundTable(niftyNext50Funds, "NIFTY NEXT 50");
  }

  html += `<p style="margin-top:20px; font-style:italic;">*This is informational — not financial advice</p>`;

  await sendMail("📉 Market Alert — Investment Opportunity", html, text);
}

main().catch((err) => console.error("❌ Error:", err));