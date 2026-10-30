# Setup

Four ways to run it. The first needs nothing but a Google account.

## A. Make a copy of the template (2 minutes)

1. Open **[the template](https://docs.google.com/spreadsheets/d/1Aq0X8NB7Qmnr-lb_Zyf0T3pODylRRAheALs8h4PRSQg/copy)** and click **Make a copy**. The copy includes its Apps
   Script, and it is yours: nobody else, including the author, can see it.
2. The copy opens with the synthetic example in every tab. Read **Start here**, then
   **Checks**, then **Readout**.
3. The **Skip-the-Call** menu appears a few seconds after the sheet loads. The first time you
   use it, Google asks for permission:
   - **Choose your account**, then **Allow**. The script asks only for "this spreadsheet"
     (`@OnlyCurrentDoc`) and for showing its dialogs; it cannot open your other files or the network.
   - If Google shows **"Google hasn't verified this app"**: that screen appears for any script
     that is not published on the Workspace Marketplace. Click **Advanced → Go to
     Skip-the-Call test (unsafe)**. The code you are authorizing is the four files in `src/`,
     visible under **Extensions → Apps Script**.
4. **Is your volume enough?** In **Config**, set `baseline_rate`, `mde` and `offers_per_week`,
   then **Skip-the-Call → 1. Plan**. The first line of Plan is the verdict.
5. With your own data: **Skip-the-Call → Reset to blank Config and Events**, fill Config, paste
   one row per subject into **Events** (`docs/data-contract.md`), then **1. Plan** and **2. Readout**.

## B. Paste into a blank sheet (5 minutes)

1. Create a blank Google Sheet.
2. **Extensions → Apps Script**. Delete the default `Code.gs` content.
3. Create four script files and paste the contents of the matching repo file into each:
   `stats.js`, `engine.js`, `synthetic.js`, `sheets.js` (the editor names them `.gs`; the code
   is the same). Order does not matter: Apps Script loads every file into one scope.
4. Save, go back to the sheet, reload the page. The **Skip-the-Call** menu appears, and the
   **Start here**, **Config** and **Events** tabs are created on that first open.
5. **Skip-the-Call → Load the example** to see every tab filled, or fill Config and Events
   with your own data and run **1. Plan** and **2. Readout**. Permission prompt: as in A.3.

## C. Push with clasp (if you want the repo to be the source of truth)

```bash
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "Skip-the-Call test" --rootDir .
clasp push
```

`.claspignore` sends only `src/*.js` and `appsscript.json`. Open the created sheet, reload,
and the menu is there.

## D. Run locally with Node (no Google account)

```bash
node examples/plan.js --baseline 3% --mde 2% --per-week 200   # step 0: the Plan from three numbers
node examples/generate.js          # writes examples/events.csv (2,400 synthetic subjects)
node examples/demo.js              # prints Plan, Readout, Maturation, Checks
node examples/demo.js examples/config-midtest.csv    # the same data read in the middle of the test
node --test tests/*.test.js        # 26 tests
```

`examples/demo.js` takes any `config.csv` and `events.csv` in the Events format, so it also
works on your real export without a Sheet.

## Reading order after a run

1. **Checks**. Anything FAIL means the pooled Readout is not the number to decide on.
2. **Readout**, the primary endpoint block: the mature rates, the interval of the difference,
   the non-inferiority verdict.
3. **Readout**, "qualified by any route": the endpoint that includes the call's second route.
4. **Maturation**, only if you are reading before the freeze + window date.
