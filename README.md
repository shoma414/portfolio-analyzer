# Portfolio Lot Analyzer

Automated dashboard that pulls your IBKR lot positions daily from Outlook and displays sell/buy signals.

## Live Dashboard
👉 https://shoma414.github.io/portfolio-analyzer

## How it works
1. IBKR sends daily CSV to your Outlook
2. GitHub Actions runs every weekday at 8:00 AM UAE time
3. Python script fetches the CSV via Microsoft Graph API
4. CSV is committed to this repo
5. Dashboard auto-loads the latest data when you open it

## Setup Instructions

### 1. Add GitHub Secrets
Go to: Settings → Secrets and variables → Actions → New repository secret

Add these 3 secrets:
- `OUTLOOK_CLIENT_ID` — your Azure app client ID
- `OUTLOOK_CLIENT_SECRET` — your Azure app client secret  
- `OUTLOOK_EMAIL` — m.s.r.z@hotmail.com

### 2. Enable GitHub Pages
Go to: Settings → Pages → Source → Deploy from branch → main → / (root) → Save

Your dashboard will be live at: https://shoma414.github.io/portfolio-analyzer

### 3. Test the workflow manually
Go to: Actions → Daily Portfolio Update → Run workflow

Check the logs to confirm the CSV was fetched successfully.

## Strategy Logic
- **Sell signal** — any lot is up ≥ 10% from cost basis
- **Near sell** — any lot is up ≥ 7% from cost basis  
- **Buy signal** — current mark price is ≥ 5% below the lowest cost lot for that stock

All thresholds are adjustable in the dashboard.
